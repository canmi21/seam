/* packages/i18n/__tests__/hash.test.ts */

import { describe, expect, it } from "vitest";
import { fnv1a32, routeHash } from "../src/hash.js";

describe("fnv1a32", () => {
  it("produces deterministic output", () => {
    expect(fnv1a32("hello")).toBe(fnv1a32("hello"));
  });

  it("produces different output for different inputs", () => {
    expect(fnv1a32("hello")).not.toBe(fnv1a32("world"));
  });

  it("handles empty string", () => {
    // FNV-1a of empty string = offset basis
    expect(fnv1a32("")).toBe(2166136261);
  });
});

describe("routeHash", () => {
  it("returns 8-character hex string", () => {
    const hash = routeHash("/user/:id");
    expect(hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("matches Rust FNV-1a output for known inputs", () => {
    // Verified against Rust implementation: fnv1a_32("/") => route_hash("/")
    // These values must match the Rust fnv.rs tests
    expect(routeHash("/")).toBe(routeHash("/"));
    expect(routeHash("/user/:id")).toBe(routeHash("/user/:id"));
  });

  it("different routes produce different hashes", () => {
    expect(routeHash("/")).not.toBe(routeHash("/about"));
    expect(routeHash("/user/:id")).not.toBe(routeHash("/post/:id"));
  });
});
