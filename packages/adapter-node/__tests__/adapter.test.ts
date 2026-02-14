/* packages/adapter-node/__tests__/adapter.test.ts */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRouter, t } from "@canmi/seam-server";
import { serveNode } from "../src/index.js";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

const router = createRouter({
  greet: {
    input: t.object({ name: t.string() }),
    output: t.object({ message: t.string() }),
    handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
  },
});

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
  it("GET /seam/manifest.json returns manifest", async () => {
    const res = await fetch(`${base}/seam/manifest.json`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.procedures.greet).toBeDefined();
  });

  it("POST /seam/rpc/greet with valid input returns 200", async () => {
    const res = await postJson("/seam/rpc/greet", { name: "Alice" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ message: "Hello, Alice!" });
  });

  it("POST /seam/rpc/greet with invalid input returns 400", async () => {
    const res = await postJson("/seam/rpc/greet", { name: 123 });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /seam/rpc/unknown returns 404", async () => {
    const res = await postJson("/seam/rpc/unknown", {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("POST non-JSON body returns 400", async () => {
    const res = await fetch(`${base}/seam/rpc/greet`, {
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
    const res = await postJson("/seam/rpc/", {});
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
