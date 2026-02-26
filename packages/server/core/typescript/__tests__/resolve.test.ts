/* packages/server/core/typescript/__tests__/resolve.test.ts */

import { describe, expect, it } from "vitest";
import {
  defaultResolve,
  fromUrlPrefix,
  fromCookie,
  fromAcceptLanguage,
  fromUrlQuery,
  resolveChain,
  defaultStrategies,
} from "../src/resolve.js";
import type { ResolveContext, ResolveData } from "../src/resolve.js";

function ctx(overrides: Partial<ResolveContext> = {}): ResolveContext {
  return {
    pathLocale: null,
    locales: ["en", "zh", "ja"],
    defaultLocale: "en",
    ...overrides,
  };
}

function data(overrides: Partial<ResolveData> = {}): ResolveData {
  return {
    url: "",
    pathLocale: null,
    cookie: undefined,
    acceptLanguage: undefined,
    locales: ["en", "zh", "ja"],
    defaultLocale: "en",
    ...overrides,
  };
}

describe("defaultResolve (backward compat)", () => {
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

describe("fromUrlPrefix", () => {
  const strategy = fromUrlPrefix();

  it("has kind url_prefix", () => {
    expect(strategy.kind).toBe("url_prefix");
  });

  it("returns pathLocale when it is a known locale", () => {
    expect(strategy.resolve(data({ pathLocale: "zh" }))).toBe("zh");
  });

  it("returns null when pathLocale is not in locales", () => {
    expect(strategy.resolve(data({ pathLocale: "fr" }))).toBeNull();
  });

  it("returns null when pathLocale is null", () => {
    expect(strategy.resolve(data())).toBeNull();
  });
});

describe("fromCookie", () => {
  const strategy = fromCookie();

  it("has kind cookie", () => {
    expect(strategy.kind).toBe("cookie");
  });

  it("extracts seam-locale cookie value", () => {
    expect(strategy.resolve(data({ cookie: "seam-locale=zh" }))).toBe("zh");
  });

  it("finds cookie among multiple values", () => {
    expect(strategy.resolve(data({ cookie: "other=1; seam-locale=ja; foo=bar" }))).toBe("ja");
  });

  it("returns null for unknown locale in cookie", () => {
    expect(strategy.resolve(data({ cookie: "seam-locale=fr" }))).toBeNull();
  });

  it("returns null when cookie header is undefined", () => {
    expect(strategy.resolve(data())).toBeNull();
  });

  it("supports custom cookie name", () => {
    const custom = fromCookie("lang");
    expect(custom.resolve(data({ cookie: "lang=ja" }))).toBe("ja");
    expect(custom.resolve(data({ cookie: "seam-locale=ja" }))).toBeNull();
  });
});

describe("fromAcceptLanguage", () => {
  const strategy = fromAcceptLanguage();

  it("has kind accept_language", () => {
    expect(strategy.kind).toBe("accept_language");
  });

  it("returns highest priority match", () => {
    expect(strategy.resolve(data({ acceptLanguage: "ja,en;q=0.8" }))).toBe("ja");
  });

  it("respects q-value ordering", () => {
    expect(strategy.resolve(data({ acceptLanguage: "en;q=0.5,zh;q=0.9" }))).toBe("zh");
  });

  it("prefix matches (zh-CN -> zh)", () => {
    expect(strategy.resolve(data({ acceptLanguage: "zh-CN,en;q=0.5" }))).toBe("zh");
  });

  it("returns null when no match", () => {
    expect(strategy.resolve(data({ acceptLanguage: "fr,de;q=0.8" }))).toBeNull();
  });

  it("returns null when header is undefined", () => {
    expect(strategy.resolve(data())).toBeNull();
  });
});

describe("fromUrlQuery", () => {
  const strategy = fromUrlQuery();

  it("has kind url_query", () => {
    expect(strategy.kind).toBe("url_query");
  });

  it("extracts lang param from URL", () => {
    expect(strategy.resolve(data({ url: "http://localhost/page?lang=zh" }))).toBe("zh");
  });

  it("returns null for unknown locale in query", () => {
    expect(strategy.resolve(data({ url: "http://localhost/page?lang=fr" }))).toBeNull();
  });

  it("returns null when param is absent", () => {
    expect(strategy.resolve(data({ url: "http://localhost/page" }))).toBeNull();
  });

  it("returns null for empty url", () => {
    expect(strategy.resolve(data({ url: "" }))).toBeNull();
  });

  it("supports custom param name", () => {
    const custom = fromUrlQuery("locale");
    expect(custom.resolve(data({ url: "http://localhost/page?locale=ja" }))).toBe("ja");
    expect(custom.resolve(data({ url: "http://localhost/page?lang=ja" }))).toBeNull();
  });
});

describe("resolveChain", () => {
  it("returns first non-null result", () => {
    const chain = [fromCookie(), fromAcceptLanguage()];
    const result = resolveChain(chain, data({ cookie: "seam-locale=ja" }));
    expect(result).toBe("ja");
  });

  it("falls through to next strategy", () => {
    const chain = [fromUrlPrefix(), fromCookie()];
    const result = resolveChain(chain, data({ cookie: "seam-locale=zh" }));
    expect(result).toBe("zh");
  });

  it("falls back to defaultLocale when all strategies return null", () => {
    const chain = [fromUrlPrefix(), fromCookie()];
    const result = resolveChain(chain, data());
    expect(result).toBe("en");
  });

  it("empty chain falls back to defaultLocale", () => {
    expect(resolveChain([], data())).toBe("en");
  });
});

describe("defaultStrategies", () => {
  it("returns url_prefix, cookie, accept_language in order", () => {
    const strategies = defaultStrategies();
    expect(strategies.map((s) => s.kind)).toEqual(["url_prefix", "cookie", "accept_language"]);
  });
});
