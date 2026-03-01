/* src/server/adapter/node/__tests__/adapter.test.ts */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { greetRouter as router } from "../../../core/typescript/__tests__/fixtures.js";
import { serveNode } from "../src/index.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

let server: Server;
let base: string;

function postJson(path: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  server = serveNode(router, { port: 0 });
  await new Promise<void>((r) => {
    if (server.listening) {
      r();
    } else {
      server.once("listening", r);
    }
  });
  const addr = server.address() as AddressInfo;
  base = `http://localhost:${addr.port}`;
});

afterAll(() => {
  server.close();
});

describe("adapter-node", () => {
  it("GET /_seam/manifest.json returns manifest", async () => {
    const res = await fetch(`${base}/_seam/manifest.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.procedures.greet).toBeDefined();
  });

  it("POST /_seam/procedure/greet with valid input returns 200", async () => {
    const res = await postJson("/_seam/procedure/greet", { name: "Alice" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, data: { message: "Hello, Alice!" } });
  });

  it("POST /_seam/procedure/greet with invalid input returns 400", async () => {
    const res = await postJson("/_seam/procedure/greet", { name: 123 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /_seam/procedure/unknown returns 404", async () => {
    const res = await postJson("/_seam/procedure/unknown", {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("POST non-JSON body returns 400", async () => {
    const res = await fetch(`${base}/_seam/procedure/greet`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("unknown route returns 404", async () => {
    const res = await fetch(`${base}/unknown`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("empty procedure name returns 404", async () => {
    const res = await postJson("/_seam/procedure/", {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
