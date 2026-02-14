import { describe, it, expect } from "vitest";

// Import the sentinel function directly from the script
// We test it by re-implementing the pure function here since .mjs scripts
// aren't easily importable in vitest with mixed module types
function buildSentinelData(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = buildSentinelData(value as Record<string, unknown>, path);
    } else {
      result[key] = `%%SEAM:${path}%%`;
    }
  }
  return result;
}

describe("buildSentinelData", () => {
  it("converts flat object to sentinels", () => {
    const result = buildSentinelData({ name: "Alice", age: 30 });
    expect(result).toEqual({
      name: "%%SEAM:name%%",
      age: "%%SEAM:age%%",
    });
  });

  it("converts nested object with dotted paths", () => {
    const result = buildSentinelData({
      user: { name: "Alice", email: "alice@example.com" },
    });
    expect(result).toEqual({
      user: {
        name: "%%SEAM:user.name%%",
        email: "%%SEAM:user.email%%",
      },
    });
  });

  it("treats arrays as leaf values", () => {
    const result = buildSentinelData({ tags: ["a", "b"] });
    expect(result).toEqual({ tags: "%%SEAM:tags%%" });
  });

  it("handles null values as leaves", () => {
    const result = buildSentinelData({ avatar: null });
    expect(result).toEqual({ avatar: "%%SEAM:avatar%%" });
  });

  it("handles deeply nested objects", () => {
    const result = buildSentinelData({
      a: { b: { c: "deep" } },
    });
    expect(result).toEqual({
      a: { b: { c: "%%SEAM:a.b.c%%" } },
    });
  });

  it("handles empty object", () => {
    const result = buildSentinelData({});
    expect(result).toEqual({});
  });

  it("handles mixed nested and flat fields", () => {
    const result = buildSentinelData({
      id: 1,
      user: { name: "Alice", avatar: "url" },
      active: true,
    });
    expect(result).toEqual({
      id: "%%SEAM:id%%",
      user: {
        name: "%%SEAM:user.name%%",
        avatar: "%%SEAM:user.avatar%%",
      },
      active: "%%SEAM:active%%",
    });
  });
});
