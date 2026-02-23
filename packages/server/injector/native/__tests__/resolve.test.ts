/* packages/server/injector/native/__tests__/resolve.test.ts */

import { describe, expect, it } from "vitest";
import { resolve } from "../src/resolve.js";

describe("resolve", () => {
  it("resolves top-level key", () => {
    expect(resolve("name", { name: "Alice" })).toBe("Alice");
  });

  it("resolves nested path", () => {
    expect(resolve("a.b.c", { a: { b: { c: 42 } } })).toBe(42);
  });

  it("returns undefined for missing key", () => {
    expect(resolve("missing", {})).toBeUndefined();
  });

  it("returns undefined for partial path", () => {
    expect(resolve("a.b", { a: 1 })).toBeUndefined();
  });

  it("returns undefined for null intermediate", () => {
    expect(resolve("a.b", { a: null })).toBeUndefined();
  });

  it("returns undefined for undefined intermediate", () => {
    expect(resolve("a.b", { a: undefined })).toBeUndefined();
  });

  it("resolves to null value", () => {
    expect(resolve("x", { x: null })).toBeNull();
  });

  it("resolves to falsy values", () => {
    expect(resolve("x", { x: 0 })).toBe(0);
    expect(resolve("x", { x: "" })).toBe("");
    expect(resolve("x", { x: false })).toBe(false);
  });
});
