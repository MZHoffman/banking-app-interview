import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { SessionProvider } from "./session";

function res(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function renderApp(path = "/sign-in") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Banking App client", () => {
  it("exposes conventional credential fields to browser password managers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(res(401, { error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in" } })),
    );
    renderApp();

    expect(await screen.findByLabelText("Email address")).toHaveAttribute("name", "username");
    expect(screen.getByLabelText("Email address")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("name", "password");
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("signs in and displays the account", async () => {
    const storeCredential = vi.fn().mockResolvedValue(undefined);
    class TestPasswordCredential {
      constructor(public readonly data: { id: string; name: string; password: string }) {}
    }
    vi.stubGlobal("PasswordCredential", TestPasswordCredential);
    vi.stubGlobal(
      "navigator",
      Object.assign(Object.create(navigator), {
        credentials: { store: storeCredential },
      }),
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(401, { error: { code: "AUTHENTICATION_REQUIRED", message: "Sign in" } }))
      .mockResolvedValueOnce(res(200, { user: { firstName: "Alex", lastName: "Morgan" } }))
      .mockResolvedValueOnce(
        res(200, {
          account: {
            holderName: "Alex Morgan",
            accountNumber: "48271",
            balanceMinor: "245075",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderApp();
    await screen.findByRole("heading", { name: "Welcome back" });
    await userEvent.type(screen.getByLabelText("Email address"), "alex.morgan@example.test");
    await userEvent.type(screen.getByLabelText("Password"), "Demo-Alex!2026");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("£2,450.75")).toBeInTheDocument();
    expect(screen.getByText("48271")).toBeInTheDocument();
    expect(storeCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          id: "alex.morgan@example.test",
          name: "Alex Morgan",
          password: "Demo-Alex!2026",
        },
      }),
    );
  });

  it("rejects a malformed deposit without calling the server", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(200, { user: { firstName: "Alex", lastName: "Morgan" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/account/deposit");
    const input = await screen.findByLabelText("Amount");
    await userEvent.type(input, "1.234");
    await userEvent.click(screen.getByRole("button", { name: "Deposit money" }));
    expect(screen.getByText("Enter a valid amount with no more than two decimal places.")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redirects a refreshed confirmation route back to transfer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res(200, { user: { firstName: "Alex", lastName: "Morgan" } })));
    renderApp("/account/transfer/confirm");
    expect(await screen.findByRole("heading", { name: "Transfer money" })).toBeInTheDocument();
    expect(screen.getByText("Please review the transfer again.")).toBeInTheDocument();
  });

  it("shows the session-expiry screen when the account call is rejected", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res(200, { user: { firstName: "Alex", lastName: "Morgan" } }))
      .mockResolvedValueOnce(res(401, { error: { code: "SESSION_EXPIRED", message: "Expired" } }));
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/account");
    await waitFor(() => expect(screen.getByRole("heading", { name: "You've been signed out" })).toBeInTheDocument());
  });
});
