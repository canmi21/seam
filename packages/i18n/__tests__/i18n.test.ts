/* packages/i18n/__tests__/i18n.test.ts */

import { describe, it, expect } from "vitest";
import { createI18n, sortMessages } from "../src/index.js";

describe("createI18n", () => {
  it("t() returns translation for existing key", () => {
    const i18n = createI18n("en", { greeting: "Hello" });
    expect(i18n.t("greeting")).toBe("Hello");
    expect(i18n.locale).toBe("en");
  });

  it("t() returns key itself for missing key", () => {
    const i18n = createI18n("en", {});
    expect(i18n.t("missing.key")).toBe("missing.key");
  });

  it("t() falls back to fallbackMessages when key missing in primary", () => {
    const i18n = createI18n("zh", { greeting: "Hi" }, { farewell: "Goodbye" });
    expect(i18n.t("farewell")).toBe("Goodbye");
  });

  it("primary messages take precedence over fallback", () => {
    const i18n = createI18n("zh", { greeting: "Hi" }, { greeting: "Hello" });
    expect(i18n.t("greeting")).toBe("Hi");
  });

  it("t() returns key when missing from both primary and fallback", () => {
    const i18n = createI18n("zh", {}, { greeting: "Hello" });
    expect(i18n.t("unknown")).toBe("unknown");
  });

  it("t() interpolates single param", () => {
    const i18n = createI18n("en", { hello: "Hello {name}" });
    expect(i18n.t("hello", { name: "Alice" })).toBe("Hello Alice");
  });

  it("t() interpolates multiple params", () => {
    const i18n = createI18n("en", { info: "{name} has {count} repos" });
    expect(i18n.t("info", { name: "Alice", count: 42 })).toBe("Alice has 42 repos");
  });

  it("t() preserves unmatched placeholders", () => {
    const i18n = createI18n("en", { msg: "Hello {name}, {title}" });
    expect(i18n.t("msg", { name: "Alice" })).toBe("Hello Alice, {title}");
  });

  it("t() interpolates fallback message", () => {
    const i18n = createI18n("zh", {}, { hello: "Hello {name}" });
    expect(i18n.t("hello", { name: "Bob" })).toBe("Hello Bob");
  });

  it("t() without params returns raw message (no interpolation overhead)", () => {
    const i18n = createI18n("en", { raw: "Has {braces} in it" });
    expect(i18n.t("raw")).toBe("Has {braces} in it");
  });
});

describe("sortMessages", () => {
  it("sorts keys alphabetically", () => {
    const sorted = sortMessages({ z: "last", a: "first", m: "middle" });
    expect(Object.keys(sorted)).toEqual(["a", "m", "z"]);
  });

  it("preserves values", () => {
    const sorted = sortMessages({ b: "B", a: "A" });
    expect(sorted).toEqual({ a: "A", b: "B" });
  });

  it("handles empty object", () => {
    expect(sortMessages({})).toEqual({});
  });
});
