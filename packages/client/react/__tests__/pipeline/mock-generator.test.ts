/* packages/client/react/__tests__/pipeline/mock-generator.test.ts */

import { describe, it, expect } from "vitest";
import {
  generateMockFromSchema,
  flattenLoaderMock,
  deepMerge,
  collectHtmlPaths,
  collectSchemaPaths,
  levenshtein,
  didYouMean,
  createAccessTracker,
  checkFieldAccess,
} from "../../scripts/mock-generator.mjs";

// -- generateMockFromSchema: primitives --

describe("generateMockFromSchema - primitives", () => {
  it("generates semantic string for 'name' field", () => {
    expect(generateMockFromSchema({ type: "string" }, "user.name")).toBe("Example Name");
  });

  it("generates URL for url/href/src fields", () => {
    expect(generateMockFromSchema({ type: "string" }, "avatar_url")).toBe("https://example.com");
    expect(generateMockFromSchema({ type: "string" }, "href")).toBe("https://example.com");
    expect(generateMockFromSchema({ type: "string" }, "icon_src")).toBe("https://example.com");
  });

  it("generates email for email field", () => {
    expect(generateMockFromSchema({ type: "string" }, "user.email")).toBe("user@example.com");
  });

  it("generates color for color field", () => {
    expect(generateMockFromSchema({ type: "string" }, "bg_color")).toBe("#888888");
  });

  it("generates description for description/bio/summary fields", () => {
    expect(generateMockFromSchema({ type: "string" }, "bio")).toBe("Sample description");
    expect(generateMockFromSchema({ type: "string" }, "description")).toBe("Sample description");
    expect(generateMockFromSchema({ type: "string" }, "summary")).toBe("Sample description");
  });

  it("generates title for title field", () => {
    expect(generateMockFromSchema({ type: "string" }, "page.title")).toBe("Sample Title");
  });

  it("generates id for id field", () => {
    expect(generateMockFromSchema({ type: "string" }, "user.id")).toBe("sample-id");
  });

  it("generates fallback string for unknown fields", () => {
    expect(generateMockFromSchema({ type: "string" }, "login")).toBe("Sample Login");
  });

  it("generates boolean true", () => {
    expect(generateMockFromSchema({ type: "boolean" })).toBe(true);
  });

  it("generates 1 for numeric types", () => {
    for (const t of ["int8", "int16", "int32", "uint8", "uint16", "uint32", "float32", "float64"]) {
      expect(generateMockFromSchema({ type: t })).toBe(1);
    }
  });

  it("generates timestamp string", () => {
    expect(generateMockFromSchema({ type: "timestamp" })).toBe("2024-01-01T00:00:00Z");
  });
});

// -- generateMockFromSchema: composite types --

describe("generateMockFromSchema - composites", () => {
  it("uses first enum value", () => {
    expect(generateMockFromSchema({ enum: ["active", "inactive", "banned"] })).toBe("active");
  });

  it("generates recursive object with properties + optionalProperties", () => {
    const schema = {
      properties: { name: { type: "string" }, age: { type: "uint32" } },
      optionalProperties: { bio: { type: "string" } },
    };
    const result = generateMockFromSchema(schema);
    expect(result).toEqual({
      name: "Example Name",
      age: 1,
      bio: "Sample description",
    });
  });

  it("generates array of 2 items for elements", () => {
    const schema = { elements: { type: "string" } };
    const result = generateMockFromSchema(schema, "tags");
    expect(result).toHaveLength(2);
    expect(typeof result[0]).toBe("string");
  });

  it("generates 2-entry record for values", () => {
    const schema = { values: { type: "uint32" } };
    const result = generateMockFromSchema(schema);
    expect(result).toEqual({ item1: 1, item2: 1 });
  });

  it("picks first mapping for discriminator", () => {
    const schema = {
      discriminator: "kind",
      mapping: {
        circle: { properties: { radius: { type: "float64" } } },
        rect: { properties: { width: { type: "float64" }, height: { type: "float64" } } },
      },
    };
    const result = generateMockFromSchema(schema);
    expect(result).toEqual({ kind: "circle", radius: 1 });
  });

  it("generates populated value for nullable schema", () => {
    const schema = { nullable: true, type: "string" };
    expect(generateMockFromSchema(schema, "name")).toBe("Example Name");
  });

  it("generates populated object for nullable object", () => {
    const schema = {
      nullable: true,
      properties: { x: { type: "uint32" } },
    };
    expect(generateMockFromSchema(schema)).toEqual({ x: 1 });
  });

  it("returns {} for empty schema", () => {
    expect(generateMockFromSchema({})).toEqual({});
  });
});

// -- generateMockFromSchema: integration --

describe("generateMockFromSchema - integration", () => {
  it("is deterministic across calls", () => {
    const schema = {
      properties: {
        name: { type: "string" },
        repos: {
          elements: {
            properties: {
              id: { type: "uint32" },
              language: { nullable: true, type: "string" },
            },
          },
        },
      },
    };
    const a = generateMockFromSchema(schema);
    const b = generateMockFromSchema(schema);
    expect(a).toEqual(b);
  });

  it("handles real-world getUser schema", () => {
    const schema = {
      properties: {
        avatar_url: { type: "string" },
        bio: { nullable: true, type: "string" },
        followers: { type: "uint32" },
        following: { type: "uint32" },
        location: { nullable: true, type: "string" },
        login: { type: "string" },
        name: { nullable: true, type: "string" },
        public_repos: { type: "uint32" },
      },
    };
    const result = generateMockFromSchema(schema);
    expect(result).toEqual({
      avatar_url: "https://example.com",
      bio: "Sample description",
      followers: 1,
      following: 1,
      location: "Sample Location",
      login: "Sample Login",
      name: "Example Name",
      public_repos: 1,
    });
  });

  it("handles real-world getUserRepos schema", () => {
    const schema = {
      elements: {
        properties: {
          description: { nullable: true, type: "string" },
          forks_count: { type: "uint32" },
          html_url: { type: "string" },
          id: { type: "uint32" },
          language: { nullable: true, type: "string" },
          name: { type: "string" },
          stargazers_count: { type: "uint32" },
        },
      },
    };
    const result = generateMockFromSchema(schema);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      description: "Sample description",
      forks_count: 1,
      html_url: "https://example.com",
      id: 1,
      language: "Sample Language",
      name: "Example Name",
      stargazers_count: 1,
    });
  });
});

// -- flattenLoaderMock --

describe("flattenLoaderMock", () => {
  it("unwraps single-loader object value", () => {
    const keyed = { user: { name: "Alice", age: 30 } };
    const flat = flattenLoaderMock(keyed);
    expect(flat.user).toEqual({ name: "Alice", age: 30 });
    expect(flat.name).toBe("Alice");
    expect(flat.age).toBe(30);
  });

  it("merges multiple loaders", () => {
    const keyed = {
      user: { login: "octocat" },
      repos: [{ id: 1 }],
    };
    const flat = flattenLoaderMock(keyed);
    expect(flat.login).toBe("octocat");
    expect(flat.repos).toEqual([{ id: 1 }]);
  });

  it("does not flatten array values", () => {
    const keyed = { items: [1, 2, 3] };
    const flat = flattenLoaderMock(keyed);
    expect(flat).toEqual({ items: [1, 2, 3] });
  });

  it("handles primitive values", () => {
    const keyed = { count: 42 };
    const flat = flattenLoaderMock(keyed);
    expect(flat).toEqual({ count: 42 });
  });
});

// -- deepMerge --

describe("deepMerge", () => {
  it("recursively merges objects", () => {
    const base = { user: { name: "Auto", age: 1 } };
    const override = { user: { name: "Custom" } };
    expect(deepMerge(base, override)).toEqual({ user: { name: "Custom", age: 1 } });
  });

  it("replaces arrays entirely", () => {
    const base = { tags: ["a", "b"] };
    const override = { tags: ["x"] };
    expect(deepMerge(base, override)).toEqual({ tags: ["x"] });
  });

  it("replaces with null", () => {
    const base = { name: "Auto" };
    const override = { name: null };
    expect(deepMerge(base, override)).toEqual({ name: null });
  });

  it("preserves keys only in base", () => {
    const base = { a: 1, b: 2, c: 3 };
    const override = { b: 20 };
    expect(deepMerge(base, override)).toEqual({ a: 1, b: 20, c: 3 });
  });

  it("handles partial override of nested structure", () => {
    const base = {
      user: { login: "auto", name: "Auto Name", bio: "Auto bio" },
      repos: [{ id: 1, name: "auto-repo" }],
    };
    const override = {
      user: { login: "octocat" },
      repos: [{ id: 1, name: "hello-world", language: "JS" }],
    };
    const result = deepMerge(base, override);
    expect(result.user).toEqual({ login: "octocat", name: "Auto Name", bio: "Auto bio" });
    expect(result.repos).toEqual([{ id: 1, name: "hello-world", language: "JS" }]);
  });

  it("replaces primitive base with override object", () => {
    expect(deepMerge("old", { a: 1 })).toEqual({ a: 1 });
  });

  it("replaces object base with primitive override", () => {
    expect(deepMerge({ a: 1 }, 42)).toBe(42);
  });
});

// -- generateMockFromSchema: html format --

describe("generateMockFromSchema - html format", () => {
  it("returns sample HTML for string with html metadata", () => {
    const schema = { type: "string", metadata: { format: "html" } };
    expect(generateMockFromSchema(schema, "content")).toBe("<p>Sample HTML content</p>");
  });

  it("returns sample HTML for nullable html string", () => {
    const schema = { nullable: true, type: "string", metadata: { format: "html" } };
    expect(generateMockFromSchema(schema, "body")).toBe("<p>Sample HTML content</p>");
  });

  it("returns plain string for non-html metadata", () => {
    const schema = { type: "string", metadata: { format: "uri" } };
    expect(generateMockFromSchema(schema, "link")).toBe("Sample Link");
  });
});

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
