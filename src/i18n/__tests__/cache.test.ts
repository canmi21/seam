/* src/i18n/__tests__/cache.test.ts */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { createI18nCache } from "../src/cache.js";
import type { HashRouter } from "../src/cache.js";

// Mock localStorage
const store = new Map<string, string>();
const mockStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => store.set(key, value)),
  removeItem: vi.fn((key: string) => store.delete(key)),
  key: vi.fn((i: number) => [...store.keys()][i] ?? null),
  get length() {
    return store.size;
  },
  clear: vi.fn(() => store.clear()),
} as unknown as Storage;

vi.stubGlobal("window", { localStorage: mockStorage });

beforeEach(() => {
  store.clear();
  vi.clearAllMocks();
});

describe("createI18nCache", () => {
  it("get returns null for missing entry", () => {
    const cache = createI18nCache();
    expect(cache.get("en", "abc12345")).toBeNull();
  });

  it("set then get returns cached entry", () => {
    const cache = createI18nCache();
    cache.set("en", "abc12345", "f1d9", { greeting: "Hello" });
    const entry = cache.get("en", "abc12345");
    expect(entry).toEqual({ hash: "f1d9", messages: { greeting: "Hello" } });
  });

  it("different locale/route combos are independent", () => {
    const cache = createI18nCache();
    cache.set("en", "abc12345", "f1d9", { greeting: "Hello" });
    cache.set("zh", "abc12345", "a2b3", { greeting: "Hi" });
    expect(cache.get("en", "abc12345")!.messages.greeting).toBe("Hello");
    expect(cache.get("zh", "abc12345")!.messages.greeting).toBe("Hi");
  });

  it("custom prefix isolates entries", () => {
    const cache1 = createI18nCache("app1:");
    const cache2 = createI18nCache("app2:");
    cache1.set("en", "abc12345", "f1d9", { a: "1" });
    cache2.set("en", "abc12345", "f1d9", { a: "2" });
    expect(cache1.get("en", "abc12345")!.messages.a).toBe("1");
    expect(cache2.get("en", "abc12345")!.messages.a).toBe("2");
  });
});

describe("validate", () => {
  it("evicts entries for unknown route hashes", () => {
    const cache = createI18nCache();
    cache.set("en", "known123", "f1d9", { a: "1" });
    cache.set("en", "unknown1", "f1d9", { a: "2" });

    const router: HashRouter = {
      known123: { en: "f1d9" },
    };
    cache.validate(router);

    expect(cache.get("en", "known123")).not.toBeNull();
    expect(cache.get("en", "unknown1")).toBeNull();
  });

  it("evicts entries with stale content hash", () => {
    const cache = createI18nCache();
    cache.set("en", "route123", "old1", { a: "stale" });

    const router: HashRouter = {
      route123: { en: "new2" },
    };
    cache.validate(router);

    expect(cache.get("en", "route123")).toBeNull();
  });

  it("keeps entries with matching content hash", () => {
    const cache = createI18nCache();
    cache.set("en", "route123", "f1d9", { a: "fresh" });

    const router: HashRouter = {
      route123: { en: "f1d9" },
    };
    cache.validate(router);

    expect(cache.get("en", "route123")).not.toBeNull();
    expect(cache.get("en", "route123")!.messages.a).toBe("fresh");
  });

  it("ignores non-prefixed localStorage keys", () => {
    store.set("unrelated-key", "value");
    const cache = createI18nCache();
    cache.set("en", "route123", "f1d9", { a: "1" });

    cache.validate({ route123: { en: "f1d9" } });
    expect(store.has("unrelated-key")).toBe(true);
  });
});
