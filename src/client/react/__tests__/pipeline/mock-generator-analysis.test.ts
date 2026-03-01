/* src/client/react/__tests__/pipeline/mock-generator-analysis.test.ts */

import { describe, it, expect } from "vitest";
import {
  collectSchemaPaths,
  levenshtein,
  didYouMean,
  createAccessTracker,
  checkFieldAccess,
  collectHtmlPaths,
} from "../../scripts/mock-generator.mjs";

// -- collectSchemaPaths --

describe("collectSchemaPaths", () => {
  it("collects keyed and flattened paths from nested schema", () => {
    const s = { properties: { page: { properties: { tagline: { type: "string" } } } } };
    const p = collectSchemaPaths(s);
    expect(p.has("page")).toBe(true);
    expect(p.has("page.tagline")).toBe(true);
    expect(p.has("tagline")).toBe(true); // flattened
  });

  it("includes nullable properties", () => {
    const s = { properties: { user: { properties: { bio: { nullable: true, type: "string" } } } } };
    const p = collectSchemaPaths(s);
    expect(p.has("user.bio")).toBe(true);
    expect(p.has("bio")).toBe(true);
  });

  it("uses $ for array element paths", () => {
    const s = { properties: { repos: { elements: { properties: { name: { type: "string" } } } } } };
    const p = collectSchemaPaths(s);
    expect(p.has("repos")).toBe(true);
    expect(p.has("repos.$.name")).toBe(true);
    expect(p.has("$.name")).toBe(true);
  });

  it("returns empty set for empty/null schema", () => {
    expect(collectSchemaPaths({}).size).toBe(0);
    expect(collectSchemaPaths(null as unknown as object).size).toBe(0);
  });

  it("includes optionalProperties", () => {
    const p = collectSchemaPaths({ optionalProperties: { nickname: { type: "string" } } });
    expect(p.has("nickname")).toBe(true);
  });
});

// -- levenshtein + didYouMean --

describe("levenshtein", () => {
  it("computes correct distances", () => {
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("abc", "abd")).toBe(1);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("", "xyz")).toBe(3);
    expect(levenshtein("abcdef", "xyz")).toBeGreaterThan(3);
  });
});

describe("didYouMean", () => {
  it("returns closest match within threshold", () => {
    expect(didYouMean("userName", ["username", "tagline", "bio"])).toBe("username");
  });
  it("returns null when no close match", () => {
    expect(didYouMean("xyzzy", ["username", "tagline", "bio"])).toBeNull();
  });
  it("returns exact match at distance 0", () => {
    expect(didYouMean("name", ["name", "age"])).toBe("name");
  });
});

// -- createAccessTracker --

describe("createAccessTracker", () => {
  it("tracks simple field access", () => {
    const a = new Set<string>();
    void (createAccessTracker({ tagline: "hello" }, a) as Record<string, unknown>).tagline;
    expect(a.has("tagline")).toBe(true);
  });

  it("tracks nested field access", () => {
    const a = new Set<string>();
    const o = createAccessTracker({ user: { name: "Alice" } }, a) as Record<
      string,
      Record<string, unknown>
    >;
    void o.user.name;
    expect(a.has("user")).toBe(true);
    expect(a.has("user.name")).toBe(true);
  });

  it("ignores symbols and framework keys", () => {
    const a = new Set<string>();
    const o = createAccessTracker({ x: 1 }, a);
    void (o as Record<symbol, unknown>)[Symbol.toPrimitive];
    void (o as Record<symbol, unknown>)[Symbol.iterator];
    void (o as Record<string, unknown>)["$$typeof"];
    void (o as Record<string, unknown>)["then"];
    void (o as Record<string, unknown>)["toJSON"];
    void (o as Record<string, unknown>)["constructor"];
    expect(a.size).toBe(0);
  });

  it("tracks array element access as prefix.$", () => {
    const a = new Set<string>();
    const o = createAccessTracker({ repos: [{ name: "seam" }] }, a) as Record<
      string,
      Array<Record<string, unknown>>
    >;
    void o.repos[0].name;
    expect(a.has("repos")).toBe(true);
    expect(a.has("repos.$")).toBe(true);
    expect(a.has("repos.$.name")).toBe(true);
  });

  it("returns undefined for missing keys without throwing", () => {
    const a = new Set<string>();
    expect((createAccessTracker({ x: 1 }, a) as Record<string, unknown>).missing).toBeUndefined();
    expect(a.has("missing")).toBe(true);
  });

  it("returns primitives as-is", () => {
    expect(createAccessTracker(null, new Set())).toBeNull();
    expect(createAccessTracker(undefined, new Set())).toBeUndefined();
    expect(createAccessTracker(42 as unknown as object, new Set())).toBe(42);
  });
});

// -- checkFieldAccess --

describe("checkFieldAccess", () => {
  const schema = {
    properties: {
      page: { properties: { tagline: { type: "string" }, username: { type: "string" } } },
    },
  };

  it("returns no warnings when all accessed fields are in schema", () => {
    expect(checkFieldAccess(new Set(["page", "page.tagline", "tagline"]), schema, "/")).toEqual([]);
  });

  it("returns warning with did-you-mean for mismatched field", () => {
    const w = checkFieldAccess(new Set(["page", "userName"]), schema, "/");
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("userName");
    expect(w[0]).toContain("Did you mean: username?");
  });

  it("skips parent object access when children exist in schema", () => {
    expect(checkFieldAccess(new Set(["page"]), schema, "/")).toEqual([]);
  });

  it("returns empty array when schema is null or empty", () => {
    expect(checkFieldAccess(new Set(["anything"]), null, "/")).toEqual([]);
    expect(checkFieldAccess(new Set(["anything"]), {}, "/")).toEqual([]);
  });
});

// -- collectHtmlPaths --

describe("collectHtmlPaths", () => {
  const html = { type: "string", metadata: { format: "html" } };

  it("collects path for flat html field", () => {
    const p = collectHtmlPaths({ properties: { content: html, title: { type: "string" } } });
    expect(p.has("content")).toBe(true);
    expect(p.has("title")).toBe(false);
  });

  it("collects nested html paths", () => {
    const p = collectHtmlPaths({
      properties: { post: { properties: { body: html, title: { type: "string" } } } },
    });
    expect(p.has("post.body")).toBe(true);
    expect(p.has("post.title")).toBe(false);
  });

  it("collects html paths inside array elements", () => {
    const p = collectHtmlPaths({
      properties: { items: { elements: { properties: { desc: html } } } },
    });
    expect(p.has("items.$.desc")).toBe(true);
  });

  it("handles nullable wrapper", () => {
    const p = collectHtmlPaths({ properties: { bio: { nullable: true, ...html } } });
    expect(p.has("bio")).toBe(true);
  });

  it("adds flattened paths (strip first segment)", () => {
    const p = collectHtmlPaths({ properties: { getPost: { properties: { body: html } } } });
    expect(p.has("getPost.body")).toBe(true);
    expect(p.has("body")).toBe(true);
  });

  it("returns empty set when no html fields", () => {
    expect(
      collectHtmlPaths({ properties: { name: { type: "string" }, count: { type: "uint32" } } })
        .size,
    ).toBe(0);
  });
});
