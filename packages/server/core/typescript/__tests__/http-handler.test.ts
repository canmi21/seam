/* packages/server/core/typescript/__tests__/http-handler.test.ts */

import { describe, expect, it } from "vitest";
import { createHttpHandler } from "../src/index.js";
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

  it("POST /_seam/rpc/greet delegates to router.handle()", async () => {
    const res = await req("POST", "/_seam/rpc/greet", { name: "Alice" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Hello, Alice!" });
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
    expect((res.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("POST /_seam/rpc/ with empty name returns 404", async () => {
    const res = await req("POST", "/_seam/rpc/", {});
    expect(res.status).toBe(404);
    expect((res.body as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  });

  it("invalid JSON body returns 400 VALIDATION_ERROR", async () => {
    const res = await handler({
      method: "POST",
      url: "http://localhost/_seam/rpc/greet",
      body: () => Promise.reject(new Error("parse error")),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("page endpoint with hasPages=false returns 404", async () => {
    // `router` has no pages registered
    expect(router.hasPages).toBe(false);
    const res = await req("GET", "/_seam/page/anything");
    expect(res.status).toBe(404);
  });
});
