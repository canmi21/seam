/* packages/client/__tests__/errors.test.ts */

import { describe, expect, it } from "vitest";
import { SeamClientError } from "../src/errors.js";

describe("SeamClientError", () => {
  it("stores code, message, and status", () => {
    const err = new SeamClientError("VALIDATION_ERROR", "bad input", 400);
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("bad input");
    expect(err.status).toBe(400);
    expect(err.name).toBe("SeamClientError");
  });

  it("extends Error", () => {
    const err = new SeamClientError("NOT_FOUND", "missing", 404);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SeamClientError);
  });
});
