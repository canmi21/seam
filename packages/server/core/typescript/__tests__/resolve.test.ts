/* packages/server/core/typescript/__tests__/resolve.test.ts */

import { describe, expect, it } from "vitest";
import { defaultResolve } from "../src/resolve.js";
import type { ResolveContext } from "../src/resolve.js";

function ctx(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    pathLocale: null,
    locales: ["en", "zh", "ja"],
    defaultLocale: "en",
    ...overrides,
  };
}

describe("defaultResolve", () => {
  it("returns pathLocale when present", () => {
    expect(defaultResolve(ctx({ pathLocale: "zh" }))).toBe("zh");
  });

  it("pathLocale beats cookie", () => {
    expect(defaultResolve(ctx({ pathLocale: "zh", cookie: "seam-locale=ja" }))).toBe("zh");
  });

  it("cookie beats Accept-Language", () => {
    expect(
      defaultResolve(ctx({ cookie: "seam-locale=ja", acceptLanguage: "zh-CN,zh;q=0.9" })),
    ).toBe("ja");
  });

  it("parses cookie value", () => {
    expect(defaultResolve(ctx({ cookie: "other=1; seam-locale=zh; foo=bar" }))).toBe("zh");
  });

  it("ignores cookie with unknown locale", () => {
    expect(defaultResolve(ctx({ cookie: "seam-locale=fr" }))).toBe("en");
  });

  it("ignores cookie with no matching name", () => {
    expect(defaultResolve(ctx({ cookie: "lang=zh" }))).toBe("en");
  });

  it("parses Accept-Language header", () => {
    expect(defaultResolve(ctx({ acceptLanguage: "ja,en;q=0.8" }))).toBe("ja");
  });

  it("respects q-value priority", () => {
    expect(defaultResolve(ctx({ acceptLanguage: "en;q=0.5,zh;q=0.9" }))).toBe("zh");
  });

  it("prefix matches Accept-Language (zh-CN -> zh)", () => {
    expect(defaultResolve(ctx({ acceptLanguage: "zh-CN,en;q=0.5" }))).toBe("zh");
  });

  it("skips unrecognized Accept-Language entries", () => {
    expect(defaultResolve(ctx({ acceptLanguage: "fr,de;q=0.8" }))).toBe("en");
  });

  it("falls back to defaultLocale when nothing matches", () => {
    expect(defaultResolve(ctx())).toBe("en");
  });

  it("falls back to defaultLocale with empty headers", () => {
    expect(defaultResolve(ctx({ cookie: "", acceptLanguage: "" }))).toBe("en");
  });
});
