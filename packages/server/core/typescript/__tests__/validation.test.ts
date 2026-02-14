/* packages/server/core/typescript/__tests__/validation.test.ts */

import { describe, expect, it } from "vitest";
import { validateInput } from "../src/validation/index.js";
import { t } from "../src/types/index.js";

describe("validateInput", () => {
  it("returns valid for correct input", () => {
    const schema = t.object({ name: t.string() });
    const result = validateInput(schema._schema, { name: "Alice" });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns errors for invalid input", () => {
    const schema = t.object({ name: t.string() });
    const result = validateInput(schema._schema, { name: 42 });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("validates nested objects", () => {
    const schema = t.object({
      user: t.object({
        name: t.string(),
        age: t.int32(),
      }),
    });
    const result = validateInput(schema._schema, { user: { name: "Bob", age: 30 } });
    expect(result.valid).toBe(true);
  });

  it("rejects missing required fields", () => {
    const schema = t.object({ name: t.string(), age: t.int32() });
    const result = validateInput(schema._schema, { name: "Alice" });
    expect(result.valid).toBe(false);
  });
});
