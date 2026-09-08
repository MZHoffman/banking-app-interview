import { afterEach, describe, expect, it, vi } from "vitest";
import { api, apiNoContent, ApiError } from "./api";

afterEach(() => vi.unstubAllGlobals());

function stubResponse(response: Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response)),
  );
}

describe("api", () => {
  it("returns the parsed body", async () => {
    stubResponse(new Response(JSON.stringify({ account: { balanceMinor: "1234" } }), { status: 200 }));
    await expect(api<{ account: { balanceMinor: string } }>("/api/account")).resolves.toEqual({
      account: { balanceMinor: "1234" },
    });
  });

  it("rejects when a body was expected but the server sent 204", async () => {
    stubResponse(new Response(null, { status: 204 }));
    await expect(api<{ account: unknown }>("/api/account")).rejects.toBeInstanceOf(ApiError);
  });

  it("raises an ApiError carrying the server's code and message", async () => {
    stubResponse(
      new Response(JSON.stringify({ error: { code: "SESSION_EXPIRED", message: "You were signed out." } }), {
        status: 401,
      }),
    );
    await expect(api("/api/account")).rejects.toMatchObject({
      status: 401,
      code: "SESSION_EXPIRED",
      message: "You were signed out.",
    });
  });
});

describe("apiNoContent", () => {
  it("resolves on 204", async () => {
    stubResponse(new Response(null, { status: 204 }));
    await expect(apiNoContent("/api/auth/heartbeat", { method: "POST" })).resolves.toBeUndefined();
  });

  it("still raises on an error status", async () => {
    stubResponse(
      new Response(JSON.stringify({ error: { code: "SESSION_EXPIRED", message: "You were signed out." } }), {
        status: 401,
      }),
    );
    await expect(apiNoContent("/api/auth/heartbeat", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
  });
});
