/* packages/server/core/typescript/__tests__/serialize.test.ts */

import { describe, expect, it } from "vitest";
import { serialize } from "../src/http.js";

describe("serialize", () => {
  it("passes through strings", () => {
    expect(serialize("hello")).toBe("hello");
  });

  it("serializes objects to JSON", () => {
    expect(serialize({ a: 1 })).toBe('{"a":1}');
  });

  it("serializes arrays to JSON", () => {
    expect(serialize([1, 2, 3])).toBe("[1,2,3]");
  });

  it("serializes null to JSON", () => {
    expect(serialize(null)).toBe("null");
  });

  it("serializes numbers to JSON", () => {
    expect(serialize(42)).toBe("42");
  });

  it("serializes boolean to JSON", () => {
    expect(serialize(true)).toBe("true");
  });
});
