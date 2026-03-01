/* src/server/core/typescript/__tests__/handler.test.ts */

import { describe, expect, it } from "vitest";
import { handleRequest } from "../src/router/handler.js";
import type { InternalProcedure } from "../src/router/handler.js";
import { greetInputSchema, greetOutputSchema } from "./fixtures.js";

function makeProcedures(...entries: [string, InternalProcedure][]) {
  return new Map(entries);
}

function greetProc(handler: InternalProcedure["handler"]) {
  return makeProcedures([
    "greet",
    { inputSchema: greetInputSchema._schema, outputSchema: greetOutputSchema._schema, handler },
  ]);
}

describe("handleRequest: success", () => {
  it("returns 200 for valid sync handler", async () => {
    const procs = greetProc(({ input }) => ({
      message: `Hi, ${(input as { name: string }).name}!`,
    }));
    const result = await handleRequest(procs, "greet", { name: "Alice" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, data: { message: "Hi, Alice!" } });
  });

  it("returns 200 for valid async handler", async () => {
    const procs = greetProc(async ({ input }) => ({
      message: `Hi, ${(input as { name: string }).name}!`,
    }));
    const result = await handleRequest(procs, "greet", { name: "Bob" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, data: { message: "Hi, Bob!" } });
  });
});

describe("handleRequest: errors", () => {
  it("returns 404 for unknown procedure", async () => {
    const procs = makeProcedures();
    const result = await handleRequest(procs, "missing", {});
    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "Procedure 'missing' not found", transient: false },
    });
  });

  it("returns 400 for invalid input", async () => {
    const procs = greetProc(() => ({ message: "unreachable" }));
    const result = await handleRequest(procs, "greet", { name: 123 });
    expect(result.status).toBe(400);
    const { error } = result.body as {
      ok: false;
      error: { code: string; message: string; transient: boolean };
    };
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.message).toContain("Input validation failed:");
  });

  it("returns 500 when handler throws generic error", async () => {
    const procs = greetProc(() => {
      throw new Error("db connection lost");
    });
    const result = await handleRequest(procs, "greet", { name: "Alice" });
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "db connection lost", transient: false },
    });
  });

  it("preserves SeamError code when handler throws SeamError", async () => {
    const { SeamError } = await import("../src/errors.js");
    const procs = greetProc(() => {
      throw new SeamError("VALIDATION_ERROR", "custom validation");
    });
    const result = await handleRequest(procs, "greet", { name: "Alice" });
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: "custom validation", transient: false },
    });
  });

  it("propagates custom error code with correct status", async () => {
    const { SeamError } = await import("../src/errors.js");
    const procs = greetProc(() => {
      throw new SeamError("RATE_LIMITED", "too fast", 429);
    });
    const result = await handleRequest(procs, "greet", { name: "Alice" });
    expect(result.status).toBe(429);
    expect(result.body).toEqual({
      ok: false,
      error: { code: "RATE_LIMITED", message: "too fast", transient: false },
    });
  });

  it("returns 500 for non-Error throws", async () => {
    const procs = greetProc(() => {
      throw "string error";
    });
    const result = await handleRequest(procs, "greet", { name: "Alice" });
    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "Unknown error", transient: false },
    });
  });
});

describe("handleRequest: output validation", () => {
  it("returns 500 when handler output is missing required fields", async () => {
    const procs = greetProc(() => ({}));
    const result = await handleRequest(procs, "greet", { name: "Alice" }, true);
    expect(result.status).toBe(500);
    expect(result.body).toEqual(
      expect.objectContaining({ error: expect.objectContaining({ code: "INTERNAL_ERROR" }) }),
    );
    expect((result.body as { error: { message: string } }).error.message).toContain(
      "Output validation failed",
    );
  });

  it("passes when output matches schema exactly", async () => {
    const procs = greetProc(() => ({ message: "Hi!" }));
    const result = await handleRequest(procs, "greet", { name: "Alice" }, true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, data: { message: "Hi!" } });
  });

  it("skips output validation when disabled", async () => {
    const procs = greetProc(() => ({}));
    const result = await handleRequest(procs, "greet", { name: "Alice" }, false);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, data: {} });
  });
});
