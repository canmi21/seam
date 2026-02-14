/* packages/server/adapter/bun/__tests__/adapter.test.ts */

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRouter, t } from "@canmi/seam-server";
import { serveBun } from "../src/index.js";

const router = createRouter({
  greet: {
    input: t.object({ name: t.string() }),
    output: t.object({ message: t.string() }),
    handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
  },
});

const server = serveBun(router, { port: 0 });
const base = `http://localhost:${server.port}`;

afterAll(() => {
  server.stop();
});

describe("adapter-bun", () => {
  it("GET /_seam/manifest.json returns manifest", async () => {
    const res = await fetch(`${base}/_seam/manifest.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.procedures.greet).toBeDefined();
  });

  it("POST /_seam/rpc/greet with valid input returns 200", async () => {
    const res = await fetch(`${base}/_seam/rpc/greet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alice" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "Hello, Alice!" });
  });

  it("POST /_seam/rpc/greet with invalid input returns 400", async () => {
    const res = await fetch(`${base}/_seam/rpc/greet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: 123 }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /_seam/rpc/unknown returns 404", async () => {
    const res = await fetch(`${base}/_seam/rpc/unknown`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("POST non-JSON body returns 400", async () => {
    const res = await fetch(`${base}/_seam/rpc/greet`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "not json",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("unknown route returns 404", async () => {
    const res = await fetch(`${base}/unknown`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("empty procedure name returns 404", async () => {
    const res = await fetch(`${base}/_seam/rpc/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});

describe("adapter-bun staticDir", () => {
  let staticDir: string;
  let staticServer: ReturnType<typeof serveBun>;
  let staticBase: string;

  afterAll(() => {
    staticServer.stop();
    rmSync(staticDir, { recursive: true, force: true });
  });

  it("serves static files through adapter", async () => {
    staticDir = mkdtempSync(join(tmpdir(), "seam-bun-static-"));
    writeFileSync(join(staticDir, "app-abc.js"), "console.log('app')");

    staticServer = serveBun(router, { port: 0, staticDir });
    staticBase = `http://localhost:${staticServer.port}`;

    const res = await fetch(`${staticBase}/_seam/static/app-abc.js`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toBe("console.log('app')");
    expect(res.headers.get("Content-Type")).toBe("application/javascript");
  });
});
