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
  it("batches calls through /_seam/procedure/_batch", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { results: [{ ok: true, data: { name: "octocat" } }] },
      }),
    );
    const { seamRpc } = await import("../src/rpc.js");

    const result = await seamRpc("getUser", { username: "octocat" });

    expect(result).toEqual({ name: "octocat" });
    expect(fetch).toHaveBeenCalledWith("/_seam/procedure/_batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calls: [{ procedure: "getUser", input: { username: "octocat" } }],
      }),
    });
  });

  it("defaults input to empty object when omitted", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { results: [{ ok: true, data: { ok: true } }] },
      }),
    );
    const { seamRpc } = await import("../src/rpc.js");

    await seamRpc("getHomeData");

    expect(fetch).toHaveBeenCalledWith("/_seam/procedure/_batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calls: [{ procedure: "getHomeData", input: {} }],
      }),
    });
  });

  it("batches same-tick calls into one request", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ok: true,
        data: {
          results: [
            { ok: true, data: "a" },
            { ok: true, data: "b" },
          ],
        },
      }),
    );
    const { seamRpc } = await import("../src/rpc.js");

    const [r1, r2] = await Promise.all([seamRpc("a", {}), seamRpc("b", {})]);

    expect(fetch).toHaveBeenCalledOnce();
    expect(r1).toBe("a");
    expect(r2).toBe("b");
  });
});

describe("seamRpc() with configureRpcMap", () => {
  it("uses hash map for wire names when configureRpcMap is called", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { results: [{ ok: true, data: { name: "octocat" } }] },
      }),
    );
    const { seamRpc, configureRpcMap } = await import("../src/rpc.js");
    configureRpcMap({
      getUser: "a1b2c3d4",
      _batch: "c9d0e1f2",
    });

    await seamRpc("getUser", { username: "octocat" });

    expect(fetch).toHaveBeenCalledWith("/_seam/procedure/c9d0e1f2", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calls: [{ procedure: "a1b2c3d4", input: { username: "octocat" } }],
      }),
    });
  });

  it("falls back to original name for unmapped procedures", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        ok: true,
        data: { results: [{ ok: true, data: "ok" }] },
      }),
    );
    const { seamRpc, configureRpcMap } = await import("../src/rpc.js");
    configureRpcMap({ getUser: "a1b2c3d4" });

    await seamRpc("unknownProc", {});

    expect(fetch).toHaveBeenCalledWith("/_seam/procedure/_batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        calls: [{ procedure: "unknownProc", input: {} }],
      }),
    });
  });

  it("propagates SeamClientError on batch failure", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        { ok: false, error: { code: "NOT_FOUND", message: "not found", transient: false } },
        404,
      ),
    );
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
