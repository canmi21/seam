/* packages/server/core/typescript/__tests__/http-handler.test.ts */

import { describe, expect, it } from "vitest";
import { createRouter, t, createHttpHandler } from "../src/index.js";

const router = createRouter({
  greet: {
    input: t.object({ name: t.string() }),
    output: t.object({ message: t.string() }),
    handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
  },
});

const handler = createHttpHandler(router);

function req(method: string, url: string, body?: unknown) {
  return handler({
    method,
    url: `http://localhost${url}`,
    body: () => (body !== undefined ? Promise.resolve(body) : Promise.reject(new Error("no body"))),
  });
}

describe("createHttpHandler", () => {
  it("GET /seam/manifest.json returns manifest", async () => {
    const res = await req("GET", "/seam/manifest.json");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect((res.body as any).procedures.greet).toBeDefined();
  });

  it("POST /seam/rpc/greet delegates to router.handle()", async () => {
    const res = await req("POST", "/seam/rpc/greet", { name: "Alice" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: "Hello, Alice!" });
  });

  it("GET /seam/page/user/1 delegates to router.handlePage()", async () => {
    // Router without pages -- should fall through to 404
    const res = await req("GET", "/seam/page/user/1");
    expect(res.status).toBe(404);
  });

  it("GET /unknown returns 404", async () => {
    const res = await req("GET", "/unknown");
    expect(res.status).toBe(404);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect((res.body as any).error.code).toBe("NOT_FOUND");
  });

  it("POST /seam/rpc/ with empty name returns 404", async () => {
    const res = await req("POST", "/seam/rpc/", {});
    expect(res.status).toBe(404);
    expect((res.body as any).error.code).toBe("NOT_FOUND");
  });

  it("invalid JSON body returns 400 VALIDATION_ERROR", async () => {
    const res = await handler({
      method: "POST",
      url: "http://localhost/seam/rpc/greet",
      body: () => Promise.reject(new Error("parse error")),
    });
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe("VALIDATION_ERROR");
  });

  it("page endpoint with hasPages=false returns 404", async () => {
    // `router` has no pages registered
    expect(router.hasPages).toBe(false);
    const res = await req("GET", "/seam/page/anything");
    expect(res.status).toBe(404);
  });
});
