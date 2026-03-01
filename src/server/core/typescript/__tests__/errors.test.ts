/* src/server/core/typescript/__tests__/errors.test.ts */

import { describe, expect, it } from "vitest";
import { SeamError, DEFAULT_STATUS } from "../src/errors.js";

describe("SeamError", () => {
  it("extends Error", () => {
    const err = new SeamError("NOT_FOUND", "not found");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SeamError");
  });

  it("stores code and message", () => {
    const err = new SeamError("VALIDATION_ERROR", "bad input");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("bad input");
  });

  it("toJSON returns spec-compliant envelope", () => {
    const err = new SeamError("INTERNAL_ERROR", "boom");
    expect(err.toJSON()).toEqual({
      ok: false,
      error: { code: "INTERNAL_ERROR", message: "boom", transient: false },
    });
  });

  it("resolves default status for known codes", () => {
    expect(new SeamError("VALIDATION_ERROR", "x").status).toBe(400);
    expect(new SeamError("UNAUTHORIZED", "x").status).toBe(401);
    expect(new SeamError("FORBIDDEN", "x").status).toBe(403);
    expect(new SeamError("NOT_FOUND", "x").status).toBe(404);
    expect(new SeamError("RATE_LIMITED", "x").status).toBe(429);
    expect(new SeamError("INTERNAL_ERROR", "x").status).toBe(500);
  });

  it("defaults to 500 for unknown codes", () => {
    const err = new SeamError("CUSTOM_ERROR", "something");
    expect(err.status).toBe(500);
  });

  it("accepts explicit status override", () => {
    const err = new SeamError("RATE_LIMITED", "slow down", 429);
    expect(err.status).toBe(429);
  });

  it("explicit status overrides default", () => {
    const err = new SeamError("NOT_FOUND", "gone", 410);
    expect(err.status).toBe(410);
  });

  it("toJSON does not include status in wire format", () => {
    const err = new SeamError("NOT_FOUND", "gone", 410);
    const json = err.toJSON();
    expect(json).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "gone", transient: false },
    });
    expect("status" in json.error).toBe(false);
  });
});

describe("DEFAULT_STATUS", () => {
  it("contains all 6 built-in codes", () => {
    expect(Object.keys(DEFAULT_STATUS)).toHaveLength(6);
    expect(DEFAULT_STATUS.VALIDATION_ERROR).toBe(400);
    expect(DEFAULT_STATUS.UNAUTHORIZED).toBe(401);
    expect(DEFAULT_STATUS.FORBIDDEN).toBe(403);
    expect(DEFAULT_STATUS.NOT_FOUND).toBe(404);
    expect(DEFAULT_STATUS.RATE_LIMITED).toBe(429);
    expect(DEFAULT_STATUS.INTERNAL_ERROR).toBe(500);
  });
});
