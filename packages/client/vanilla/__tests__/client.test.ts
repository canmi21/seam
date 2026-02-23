/* packages/client/vanilla/__tests__/client.test.ts */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "../src/client.js";
import { SeamClientError } from "../src/errors.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("call(): success", () => {
  it("returns parsed body on success", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ message: "Hello" }));

    const client = createClient({ baseUrl: "http://localhost:3000" });
    const result = await client.call("greet", { name: "Alice" });

    expect(result).toEqual({ message: "Hello" });
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/_seam/rpc/greet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
  });

  it("normalizes trailing slash in baseUrl", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ok: true }));

    const client = createClient({ baseUrl: "http://localhost:3000/" });
    await client.call("greet", {});

    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/_seam/rpc/greet", expect.any(Object));
  });
});

describe("call(): errors", () => {
  it("throws VALIDATION_ERROR on 400", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(
        jsonResponse({ error: { code: "VALIDATION_ERROR", message: "bad input" } }, 400),
      ),
    );

    const client = createClient({ baseUrl: "http://localhost:3000" });
    await expect(client.call("greet", {})).rejects.toThrow(SeamClientError);

    try {
      await client.call("greet", {});
    } catch (e) {
      const err = e as SeamClientError;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.status).toBe(400);
    }
  });

  it("throws NOT_FOUND on 404", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: { code: "NOT_FOUND", message: "not found" } }, 404),
    );

    const client = createClient({ baseUrl: "http://localhost:3000" });

    try {
      await client.call("missing", {});
    } catch (e) {
      const err = e as SeamClientError;
      expect(err.code).toBe("NOT_FOUND");
      expect(err.status).toBe(404);
    }
  });

  it("throws INTERNAL_ERROR on 500", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "server error" } }, 500),
    );

    const client = createClient({ baseUrl: "http://localhost:3000" });

    try {
      await client.call("greet", {});
    } catch (e) {
      const err = e as SeamClientError;
      expect(err.code).toBe("INTERNAL_ERROR");
      expect(err.status).toBe(500);
    }
  });

  it("throws INTERNAL_ERROR with status 0 on network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));

    const client = createClient({ baseUrl: "http://localhost:3000" });

    try {
      await client.call("greet", {});
    } catch (e) {
      const err = e as SeamClientError;
      expect(err.code).toBe("INTERNAL_ERROR");
      expect(err.status).toBe(0);
      expect(err.message).toBe("Network request failed");
    }
  });

  it("preserves unknown error code from server", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: { code: "RATE_LIMITED", message: "too fast" } }, 429),
    );

    const client = createClient({ baseUrl: "http://localhost:3000" });

    try {
      await client.call("greet", {});
    } catch (e) {
      const err = e as SeamClientError;
      expect(err.code).toBe("RATE_LIMITED");
      expect(err.status).toBe(429);
      expect(err.message).toBe("too fast");
    }
  });

  it("falls back to INTERNAL_ERROR for non-standard error body", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ unexpected: "shape" }, 500));

    const client = createClient({ baseUrl: "http://localhost:3000" });

    try {
      await client.call("greet", {});
    } catch (e) {
      const err = e as SeamClientError;
      expect(err.code).toBe("INTERNAL_ERROR");
      expect(err.status).toBe(500);
    }
  });
});

describe("fetchManifest()", () => {
  it("returns manifest on success", async () => {
    const manifest = { procedures: { greet: {} } };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(manifest));

    const client = createClient({ baseUrl: "http://localhost:3000" });
    const result = await client.fetchManifest();

    expect(result).toEqual(manifest);
    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/_seam/manifest.json");
  });

  it("throws SeamClientError on error response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ error: { code: "INTERNAL_ERROR", message: "fail" } }, 500),
    );

    const client = createClient({ baseUrl: "http://localhost:3000" });
    await expect(client.fetchManifest()).rejects.toThrow(SeamClientError);
  });

  it("throws with status 0 on network failure", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));

    const client = createClient({ baseUrl: "http://localhost:3000" });

    try {
      await client.fetchManifest();
    } catch (e) {
      const err = e as SeamClientError;
      expect(err.code).toBe("INTERNAL_ERROR");
      expect(err.status).toBe(0);
    }
  });
});
