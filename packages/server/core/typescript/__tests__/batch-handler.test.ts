/* packages/server/core/typescript/__tests__/batch-handler.test.ts */

import { describe, expect, it } from "vitest";
import { createHttpHandler } from "../src/index.js";
import { handleBatchRequest } from "../src/router/handler.js";
import { greetRouter as router, greetInputSchema, greetOutputSchema } from "./fixtures.js";
import type { InternalProcedure } from "../src/router/handler.js";
import type { BatchResultItem } from "../src/router/handler.js";

const handler = createHttpHandler(router);

function req(method: string, url: string, body?: unknown) {
  return handler({
    method,
    url: `http://localhost${url}`,
    body: () => (body !== undefined ? Promise.resolve(body) : Promise.reject(new Error("no body"))),
  });
}

/* --- handleBatchRequest unit tests --- */

const procedureMap = new Map<string, InternalProcedure>([
  [
    "greet",
    {
      inputSchema: greetInputSchema._schema,
      outputSchema: greetOutputSchema._schema,
      handler: ({ input }) => ({ message: `Hello, ${(input as { name: string }).name}!` }),
    },
  ],
]);

describe("handleBatchRequest", () => {
  it("resolves all calls in parallel when all succeed", async () => {
    const { results } = await handleBatchRequest(procedureMap, [
      { procedure: "greet", input: { name: "Alice" } },
      { procedure: "greet", input: { name: "Bob" } },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ ok: true, data: { message: "Hello, Alice!" } });
    expect(results[1]).toEqual({ ok: true, data: { message: "Hello, Bob!" } });
  });

  it("returns mixed success/failure results", async () => {
    const { results } = await handleBatchRequest(procedureMap, [
      { procedure: "greet", input: { name: "Alice" } },
      { procedure: "unknown", input: {} },
    ]);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ ok: true, data: { message: "Hello, Alice!" } });
    expect(results[1]).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Procedure 'unknown' not found" },
    });
  });

  it("returns error for unknown procedure", async () => {
    const { results } = await handleBatchRequest(procedureMap, [
      { procedure: "nonexistent", input: {} },
    ]);
    expect(results).toHaveLength(1);
    const item = results[0] as BatchResultItem & { ok: false };
    expect(item.ok).toBe(false);
    expect(item.error.code).toBe("NOT_FOUND");
  });

  it("returns empty results for empty calls array", async () => {
    const { results } = await handleBatchRequest(procedureMap, []);
    expect(results).toEqual([]);
  });
});

/* --- HTTP-level batch tests --- */

describe("POST /_seam/rpc/_batch", () => {
  it("returns 200 with per-call results on success", async () => {
    const res = await req("POST", "/_seam/rpc/_batch", {
      calls: [
        { procedure: "greet", input: { name: "Alice" } },
        { procedure: "greet", input: { name: "Bob" } },
      ],
    });
    expect(res.status).toBe(200);
    const body = res.body as { results: BatchResultItem[] };
    expect(body.results).toHaveLength(2);
    expect(body.results[0]).toEqual({ ok: true, data: { message: "Hello, Alice!" } });
    expect(body.results[1]).toEqual({ ok: true, data: { message: "Hello, Bob!" } });
  });

  it("returns 400 for invalid JSON body", async () => {
    const res = await handler({
      method: "POST",
      url: "http://localhost/_seam/rpc/_batch",
      body: () => Promise.reject(new Error("parse error")),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when body is missing 'calls' array", async () => {
    const res = await req("POST", "/_seam/rpc/_batch", { notCalls: [] });
    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string; message: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toContain("calls");
  });

  it("returns 400 when body is null", async () => {
    const res = await req("POST", "/_seam/rpc/_batch", null);
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
  });

  it("handles mixed success and failure per-call", async () => {
    const res = await req("POST", "/_seam/rpc/_batch", {
      calls: [
        { procedure: "greet", input: { name: "Alice" } },
        { procedure: "nonexistent", input: {} },
      ],
    });
    expect(res.status).toBe(200);
    const body = res.body as { results: BatchResultItem[] };
    expect(body.results[0]).toEqual({ ok: true, data: { message: "Hello, Alice!" } });
    expect((body.results[1] as { ok: false; error: { code: string } }).error.code).toBe(
      "NOT_FOUND",
    );
  });
});
