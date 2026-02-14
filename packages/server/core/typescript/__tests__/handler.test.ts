/* packages/server/core/typescript/__tests__/handler.test.ts */

import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/router/handler.js";
import type { InternalProcedure } from "../src/router/handler.js";
import { t } from "../src/types/index.js";

function makeProcedures(...entries: [string, InternalProcedure][]) {
  return new Map(entries);
}

const greetSchema = t.object({ name: t.string() });
const greetOutputSchema = t.object({ message: t.string() });

describe("handleRequest", () => {
  it("returns 200 for valid sync handler", async () => {
    const procs = makeProcedures([
      "greet",
      {
        inputSchema: greetSchema._schema,
        outputSchema: greetOutputSchema._schema,
        handler: ({ input }) => ({ message: `Hi, ${(input as { name: string }).name}!` }),
      },
    ]);
    const result = await handleRequest(procs, "greet", { name: "Alice" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ message: "Hi, Alice!" });
  });

  it("returns 200 for valid async handler", async () => {
    const procs = makeProcedures([
      "greet",
      {
        inputSchema: greetSchema._schema,
        outputSchema: greetOutputSchema._schema,
        handler: async ({ input }) => ({ message: `Hi, ${(input as { name: string }).name}!` }),
      },
    ]);
    const result = await handleRequest(procs, "greet", { name: "Bob" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ message: "Hi, Bob!" });
  });

  it("returns 404 for unknown procedure", async () => {
    const procs = makeProcedures();
    const result = await handleRequest(procs, "missing", {});
    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      error: { code: "NOT_FOUND", message: "Procedure 'missing' not found" },
    });
  });

  it("returns 400 for invalid input", async () => {
    const procs = makeProcedures([
      "greet",
      {
        inputSchema: greetSchema._schema,
        outputSchema: greetOutputSchema._schema,
        handler: () => ({ message: "unreachable" }),
      },
    ]);
    const result = await handleRequest(procs, "greet", { name: 123 });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "Input validation failed" },
    });
  });

  it("returns 500 when handler throws generic error", async () => {
    const procs = makeProcedures([
      "greet",
      {
        inputSchema: greetSchema._schema,
        outputSchema: greetOutputSchema._schema,
        handler: () => {
          throw new Error("db connection lost");
        },
      },
    ]);
    const result = await handleRequest(procs, "greet", { name: "Alice" });
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "db connection lost" },
    });
  });

  it("preserves SeamError code when handler throws SeamError", async () => {
    const { SeamError } = await import("../src/errors.js");
    const procs = makeProcedures([
      "greet",
      {
        inputSchema: greetSchema._schema,
        outputSchema: greetOutputSchema._schema,
        handler: () => {
          throw new SeamError("VALIDATION_ERROR", "custom validation");
        },
      },
    ]);
    const result = await handleRequest(procs, "greet", { name: "Alice" });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: { code: "VALIDATION_ERROR", message: "custom validation" },
    });
  });

  it("returns 500 for non-Error throws", async () => {
    const procs = makeProcedures([
      "greet",
      {
        inputSchema: greetSchema._schema,
        outputSchema: greetOutputSchema._schema,
        handler: () => {
          throw "string error";
        },
      },
    ]);
    const result = await handleRequest(procs, "greet", { name: "Alice" });
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Unknown error" },
    });
  });
});
