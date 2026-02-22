/* packages/client/vanilla/__tests__/rpc.test.ts */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("seamRpc()", () => {
  it("calls the correct RPC URL with relative base", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ name: "octocat" }));
    const { seamRpc } = await import("../src/rpc.js");

    const result = await seamRpc("getUser", { username: "octocat" });

    expect(result).toEqual({ name: "octocat" });
    expect(fetch).toHaveBeenCalledWith("/_seam/rpc/getUser", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "octocat" }),
    });
  });

  it("defaults input to empty object when omitted", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }));
    const { seamRpc } = await import("../src/rpc.js");

    await seamRpc("getHomeData");

    expect(fetch).toHaveBeenCalledWith("/_seam/rpc/getHomeData", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  });

  it("reuses the same client across calls", async () => {
    // Return fresh Response per call to avoid "body already read"
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    const { seamRpc } = await import("../src/rpc.js");

    await seamRpc("a", {});
    await seamRpc("b", {});

    const calls = vi.mocked(fetch).mock.calls;
    expect(calls[0][0]).toBe("/_seam/rpc/a");
    expect(calls[1][0]).toBe("/_seam/rpc/b");
  });

  it("propagates SeamClientError on failure", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404),
    );
    // Import SeamClientError from same module graph to match class identity
    const { seamRpc } = await import("../src/rpc.js");

    try {
      await seamRpc("missing");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as Error).name).toBe("SeamClientError");
      expect((e as { code: string }).code).toBe("NOT_FOUND");
      expect((e as { status: number }).status).toBe(404);
    }
  });
});
