import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { SessionProvider } from "./session";

// The transfer flow spans two screens and the only request that moves money is the
// second one, so these tests care about what reaches the server and what the user is
// told when it comes back an error. The amount and account-number rules themselves
// are unit tested in money.test.ts and account.test.ts.

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const session = { user: { firstName: "Alex", lastName: "Morgan" } };
const accountBody = { account: { holderName: "Alex Morgan", accountNumber: "48271", balanceMinor: "245075" } };
const previewBody = { preview: { amountMinor: "2550", recipient: { name: "Jamie Chen", accountNumber: "61504" } } };
const transferBody = {
  result: { amountMinor: "2550", balanceMinor: "242525", recipient: { name: "Jamie Chen", accountNumber: "61504" } },
};

const expired = { error: { code: "SESSION_EXPIRED", message: "You were signed out." } };
const unavailable = { error: { code: "RECIPIENT_UNAVAILABLE", message: "That recipient is unavailable." } };
const declined = {
  error: { code: "INSUFFICIENT_FUNDS", message: "Your account does not have enough available funds." },
};

type Route = () => Response | Promise<Response>;
type Call = { path: string; body: Record<string, string> | undefined };

// Routes replies by path rather than by call order, so a test only has to describe
// the endpoints it cares about, and records what was sent for later assertions.
function stubApi(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn((path: string, init?: RequestInit) => {
    calls.push({
      path,
      body: init?.body ? (JSON.parse(init.body as string) as Record<string, string>) : undefined,
    });
    const route = routes[path];
    if (!route) throw new Error(`Unexpected request to ${path}`);
    return Promise.resolve(route());
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock, sentTo: (path: string) => calls.filter((call) => call.path === path) };
}

function renderApp(path = "/account/transfer") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
}

async function fillTransfer({ recipient = "61504", amount = "25.50" } = {}) {
  await userEvent.type(await screen.findByLabelText("Recipient account number"), recipient);
  await userEvent.type(screen.getByLabelText("Amount"), amount);
  await userEvent.click(screen.getByRole("button", { name: "Review transfer" }));
}

afterEach(() => vi.unstubAllGlobals());

describe("transfer flow", () => {
  it("reviews a transfer and shows the recipient it resolved", async () => {
    const { sentTo } = stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => res(200, previewBody),
    });
    renderApp();
    await fillTransfer();

    expect(await screen.findByRole("heading", { name: "Check before you send" })).toBeInTheDocument();
    expect(screen.getByText("Jamie Chen")).toBeInTheDocument();
    expect(screen.getByText("61504")).toBeInTheDocument();
    expect(screen.getByText("£25.50")).toBeInTheDocument();
    expect(screen.getByText("Transferred funds may not be recoverable.")).toBeInTheDocument();
    expect(sentTo("/api/transfers/preview")[0]?.body).toEqual({ amount: "25.50", recipientAccountNumber: "61504" });
  });

  it("sends the transfer and returns to the account with a confirmation", async () => {
    const { sentTo } = stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => res(200, previewBody),
      "/api/transfers": () => res(200, transferBody),
      "/api/account": () => res(200, accountBody),
    });
    renderApp();
    await fillTransfer();
    await userEvent.click(await screen.findByRole("button", { name: "Confirm and send" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Sent £25.50 to Jamie Chen (61504).");
    expect(screen.getByRole("heading", { name: "Hello, Alex" })).toBeInTheDocument();
    expect(sentTo("/api/transfers")[0]?.body).toEqual({
      amount: "25.50",
      recipientAccountNumber: "61504",
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it("carries the details back to the form when you choose to edit", async () => {
    stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => res(200, previewBody),
    });
    renderApp();
    await fillTransfer();
    await userEvent.click(await screen.findByRole("button", { name: "Edit transfer" }));

    expect(await screen.findByRole("heading", { name: "Transfer money" })).toBeInTheDocument();
    expect(screen.getByLabelText("Recipient account number")).toHaveValue("61504");
    expect(screen.getByLabelText("Amount")).toHaveValue("25.50");
  });
});

describe("transfer form errors", () => {
  it("rejects a malformed transfer without calling the server", async () => {
    const { fetchMock } = stubApi({ "/api/auth/session": () => res(200, session) });
    renderApp();
    await fillTransfer({ recipient: "4827", amount: "1.234" });

    expect(screen.getByText("Enter a valid five-digit account number.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid amount with no more than two decimal places.")).toBeInTheDocument();
    // Only the session lookup the provider makes on mount.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("clears the errors as soon as you correct the form", async () => {
    stubApi({ "/api/auth/session": () => res(200, session) });
    renderApp();
    await fillTransfer({ recipient: "4827", amount: "1.234" });
    await userEvent.type(screen.getByLabelText("Recipient account number"), "1");

    expect(screen.queryByText("Enter a valid five-digit account number.")).not.toBeInTheDocument();
    expect(screen.queryByText("Enter a valid amount with no more than two decimal places.")).not.toBeInTheDocument();
  });

  it("shows the server's reason when the recipient is unavailable", async () => {
    stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => res(404, unavailable),
    });
    renderApp();
    await fillTransfer({ recipient: "99999" });

    expect(await screen.findByRole("alert")).toHaveTextContent("That recipient is unavailable.");
    expect(screen.getByRole("heading", { name: "Transfer money" })).toBeInTheDocument();
  });

  it("falls back to a generic message when a failure carries no JSON", async () => {
    stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => new Response("<html>Bad gateway</html>", { status: 502 }),
    });
    renderApp();
    await fillTransfer();

    expect(await screen.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });

  it("disables the review button while the recipient is being checked", async () => {
    let release: ((value: Response) => void) | undefined;
    stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => new Promise((resolve) => (release = resolve)),
    });
    renderApp();
    await fillTransfer();

    expect(await screen.findByRole("button", { name: "Checking recipient..." })).toBeDisabled();
    release!(res(200, previewBody));
    expect(await screen.findByRole("heading", { name: "Check before you send" })).toBeInTheDocument();
  });
});

describe("transfer confirmation errors", () => {
  it("keeps you on the review screen when the transfer is declined", async () => {
    stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => res(200, previewBody),
      "/api/transfers": () => res(409, declined),
    });
    renderApp();
    await fillTransfer();
    await userEvent.click(await screen.findByRole("button", { name: "Confirm and send" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Your account does not have enough available funds.");
    expect(screen.getByRole("heading", { name: "Check before you send" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm and send" })).toBeEnabled();
  });

  it("reuses the same idempotency key when a failed send is retried", async () => {
    // The retry has to be the same operation as far as the server is concerned, or a
    // send that actually succeeded before the error would be charged twice.
    const { sentTo } = stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => res(200, previewBody),
      "/api/transfers": () => res(500, { error: { code: "INTERNAL_ERROR", message: "Something went wrong." } }),
    });
    renderApp();
    await fillTransfer();
    await userEvent.click(await screen.findByRole("button", { name: "Confirm and send" }));
    await screen.findByRole("alert");
    await userEvent.click(screen.getByRole("button", { name: "Confirm and send" }));

    const keys = sentTo("/api/transfers").map((call) => call.body?.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it("sends once however often the confirm button is pressed", async () => {
    let release: ((value: Response) => void) | undefined;
    const { sentTo } = stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => res(200, previewBody),
      "/api/transfers": () => new Promise((resolve) => (release = resolve)),
      "/api/account": () => res(200, accountBody),
    });
    renderApp();
    await fillTransfer();
    await userEvent.click(await screen.findByRole("button", { name: "Confirm and send" }));

    const sending = await screen.findByRole("button", { name: "Sending..." });
    expect(sending).toBeDisabled();
    await userEvent.click(sending);
    expect(sentTo("/api/transfers")).toHaveLength(1);

    release!(res(200, transferBody));
    expect(await screen.findByRole("status")).toHaveTextContent("Sent £25.50 to Jamie Chen (61504).");
  });
});

describe("transfer session expiry", () => {
  it("shows the session-expiry screen when the preview is rejected", async () => {
    stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => res(401, expired),
    });
    renderApp();
    await fillTransfer();

    expect(await screen.findByRole("heading", { name: "You've been signed out" })).toBeInTheDocument();
  });

  it("shows the session-expiry screen when the send is rejected", async () => {
    stubApi({
      "/api/auth/session": () => res(200, session),
      "/api/transfers/preview": () => res(200, previewBody),
      "/api/transfers": () =>
        res(401, { error: { code: "AUTHENTICATION_REQUIRED", message: "Please sign in to continue." } }),
    });
    renderApp();
    await fillTransfer();
    await userEvent.click(await screen.findByRole("button", { name: "Confirm and send" }));

    expect(await screen.findByRole("heading", { name: "You've been signed out" })).toBeInTheDocument();
  });
});
