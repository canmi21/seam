/* packages/client/react/__tests__/pipeline/mock-generator.test.ts */

import { describe, it, expect } from "vitest";
import {
  generateMockFromSchema,
  flattenLoaderMock,
  deepMerge,
} from "../../scripts/mock-generator.mjs";

// -- generateMockFromSchema --

describe("generateMockFromSchema", () => {
  describe("primitive types", () => {
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
      for (const t of [
        "int8",
        "int16",
        "int32",
        "uint8",
        "uint16",
        "uint32",
        "float32",
        "float64",
      ]) {
        expect(generateMockFromSchema({ type: t })).toBe(1);
      }
    });

    it("generates timestamp string", () => {
      expect(generateMockFromSchema({ type: "timestamp" })).toBe("2024-01-01T00:00:00Z");
    });
  });

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
    // Mirrors github-dashboard getUser procedure output
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
    // user object fields flatten to root
    expect(flat.login).toBe("octocat");
    // array values stay keyed only (not flattened)
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
