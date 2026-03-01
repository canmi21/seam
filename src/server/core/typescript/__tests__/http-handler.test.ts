/* src/server/core/typescript/__tests__/http-handler.test.ts */

import { describe, expect, it } from "vitest";
import { createHttpHandler, drainStream } from "../src/index.js";
import { greetRouter as router } from "./fixtures.js";

const handler = createHttpHandler(router);

function req(method: string, url: string, body?: unknown) {
  return handler({
    method,
    url: `http://localhost${url}`,
    body: () => (body !== undefined ? Promise.resolve(body) : Promise.reject(new Error("no body"))),
  });
}

describe("createHttpHandler", () => {
  it("GET /_seam/manifest.json returns manifest", async () => {
    const res = await req("GET", "/_seam/manifest.json");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect((res.body as { procedures: Record<string, unknown> }).procedures.greet).toBeDefined();
  });

  it("POST /_seam/procedure/greet delegates to router.handle()", async () => {
    const res = await req("POST", "/_seam/procedure/greet", { name: "Alice" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { message: "Hello, Alice!" } });
  });

  it("GET /_seam/page/user/1 delegates to router.handlePage()", async () => {
    // Router without pages -- should fall through to 404
    const res = await req("GET", "/_seam/page/user/1");
    expect(res.status).toBe(404);
  });

  it("GET /unknown returns 404", async () => {
    const res = await req("GET", "/unknown");
    expect(res.status).toBe(404);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect((res.body as { ok: false; error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("POST /_seam/procedure/ with empty name returns 404", async () => {
    const res = await req("POST", "/_seam/procedure/", {});
    expect(res.status).toBe(404);
    expect((res.body as { ok: false; error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("invalid JSON body returns 400 VALIDATION_ERROR", async () => {
    const res = await handler({
      method: "POST",
      url: "http://localhost/_seam/procedure/greet",
      body: () => Promise.reject(new Error("parse error")),
    });
    expect(res.status).toBe(400);
    expect((res.body as { ok: false; error: { code: string } }).error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("page endpoint with hasPages=false returns 404", async () => {
    // `router` has no pages registered
    expect(router.hasPages).toBe(false);
    const res = await req("GET", "/_seam/page/anything");
    expect(res.status).toBe(404);
  });
});

describe("createHttpHandler with rpcHashMap", () => {
  const hashMap = {
    procedures: { greet: "a1b2c3d4" },
    batch: "e5f6a7b8",
  };
  const obfHandler = createHttpHandler(router, { rpcHashMap: hashMap });

  function obfReq(method: string, url: string, body?: unknown) {
    return obfHandler({
      method,
      url: `http://localhost${url}`,
      body: () =>
        body !== undefined ? Promise.resolve(body) : Promise.reject(new Error("no body")),
    });
  }

  it("resolves hashed RPC endpoint to original procedure", async () => {
    const res = await obfReq("POST", "/_seam/procedure/a1b2c3d4", { name: "Alice" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { message: "Hello, Alice!" } });
  });

  it("returns 404 for unknown hash in obfuscated mode", async () => {
    const res = await obfReq("POST", "/_seam/procedure/deadbeef", { name: "Alice" });
    expect(res.status).toBe(404);
  });

  it("resolves hashed batch endpoint", async () => {
    const res = await obfReq("POST", "/_seam/procedure/e5f6a7b8", {
      calls: [{ procedure: "a1b2c3d4", input: { name: "Bob" } }],
    });
    expect(res.status).toBe(200);
    const envelope = res.body as {
      ok: true;
      data: { results: Array<{ ok: boolean; data: unknown }> };
    };
    expect(envelope.data.results[0].ok).toBe(true);
    expect(envelope.data.results[0].data).toEqual({ message: "Hello, Bob!" });
  });

  it("still accepts original _batch endpoint in obfuscated mode", async () => {
    const res = await obfReq("POST", "/_seam/procedure/_batch", {
      calls: [{ procedure: "a1b2c3d4", input: { name: "Eve" } }],
    });
    expect(res.status).toBe(200);
  });

  it("disables manifest endpoint when obfuscated", async () => {
    const res = await obfReq("GET", "/_seam/manifest.json");
    expect(res.status).toBe(403);
  });
});

describe("drainStream", () => {
  it("drains all chunks from an async iterable", async () => {
    async function* source() {
      yield "a";
      yield "b";
      yield "c";
    }
    const written: string[] = [];
    await drainStream(source(), (chunk) => {
      written.push(chunk);
    });
    expect(written).toEqual(["a", "b", "c"]);
  });

  it("stops early when write returns false", async () => {
    async function* source() {
      yield "a";
      yield "b";
      yield "c";
    }
    const written: string[] = [];
    await drainStream(source(), (chunk) => {
      written.push(chunk);
      if (chunk === "b") return false;
    });
    expect(written).toEqual(["a", "b"]);
  });

  it("absorbs errors from the stream without propagating", async () => {
    async function* source() {
      yield "a";
      throw new Error("connection reset");
    }
    const written: string[] = [];
    await drainStream(source(), (chunk) => {
      written.push(chunk);
    });
    expect(written).toEqual(["a"]);
  });
});
