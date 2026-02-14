import { describe, expect, it } from "vitest";
import { SeamError } from "../src/errors.js";

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
      error: { code: "INTERNAL_ERROR", message: "boom" },
    });
  });
});
