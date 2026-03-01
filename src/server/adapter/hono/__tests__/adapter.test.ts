/* src/server/adapter/hono/__tests__/adapter.test.ts */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { greetRouter } from "../../../core/typescript/__tests__/fixtures.js";
import { seam } from "../src/index.js";

const app = new Hono();
app.use("/*", seam(greetRouter));
app.get("/hello", (c) => c.text("world"));

function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("adapter-hono", () => {
  it("GET /_seam/manifest.json returns manifest", async () => {
    const res = await app.request("/_seam/manifest.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.procedures.greet).toBeDefined();
  });

  it("POST /_seam/procedure/greet with valid input returns 200", async () => {
    const res = await post("/_seam/procedure/greet", { name: "Alice" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { message: "Hello, Alice!" } });
  });

  it("POST /_seam/procedure/greet with invalid input returns 400", async () => {
    const res = await post("/_seam/procedure/greet", { name: 123 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /_seam/procedure/unknown returns 404", async () => {
    const res = await post("/_seam/procedure/unknown", {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("POST non-JSON body returns 400", async () => {
    const res = await app.request("/_seam/procedure/greet", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("non-/_seam/ route passes through to next middleware", async () => {
    const res = await app.request("/hello");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("world");
  });
});
