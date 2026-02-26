/* packages/server/core/typescript/__tests__/i18n-router.test.ts */

import { describe, expect, it } from "vitest";
import { createRouter } from "../src/router/index.js";
import type { PageDef, I18nConfig } from "../src/page/index.js";
import type { ResolveLocaleFn } from "../src/resolve.js";
import { t } from "../src/types/index.js";

const page: PageDef = {
  template: "<html><body><h1><!--seam:user.name--></h1></body></html>",
  localeTemplates: {
    en: "<html><body><h1><!--seam:user.name--></h1></body></html>",
    zh: "<html><body><h1>ZH <!--seam:user.name--></h1></body></html>",
  },
  loaders: {
    user: (params) => ({ procedure: "getUser", input: { id: params.id } }),
  },
  layoutChain: [],
};

const i18nConfig: I18nConfig = {
  locales: ["en", "zh"],
  default: "en",
  messages: {
    en: { greeting: "Hello" },
    zh: { greeting: "Hi zh" },
  },
};

function makeRouter(i18n?: I18nConfig | null, resolveLocale?: ResolveLocaleFn) {
  return createRouter(
    {
      getUser: {
        input: t.object({ id: t.string() }),
        output: t.object({ name: t.string() }),
        handler: ({ input }) => ({ name: `User-${input.id}` }),
      },
    },
    {
      pages: {
        "/": {
          template: "<html><body>home</body></html>",
          loaders: {},
          layoutChain: [],
        },
        "/user/:id": page,
      },
      i18n,
      resolveLocale,
    },
  );
}

describe("router -- locale extraction", () => {
  it("/zh/user/42 -> locale=zh, path=/user/42", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/zh/user/42");
    expect(result).not.toBeNull();
    expect(result!.html).toContain("ZH User-42");
    expect(result!.html).toContain('lang="zh"');
  });

  it("/en/user/42 -> locale=en, path=/user/42", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/en/user/42");
    expect(result).not.toBeNull();
    expect(result!.html).not.toContain("ZH");
    expect(result!.html).toContain("User-42");
    expect(result!.html).toContain('lang="en"');
  });

  it("/user/42 -> default locale (en)", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/user/42");
    expect(result).not.toBeNull();
    expect(result!.html).toContain("User-42");
    expect(result!.html).toContain('lang="en"');
  });

  it("/ with locale prefix /en/ -> home page", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/en/");
    expect(result).not.toBeNull();
    expect(result!.html).toContain("home");
  });

  it("/zh/ -> home page with zh locale", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/zh/");
    expect(result).not.toBeNull();
    expect(result!.html).toContain('lang="zh"');
  });

  it("no i18n config -> plain path matching, no lang attr", async () => {
    const router = makeRouter(null);
    const result = await router.handlePage("/user/42");
    expect(result).not.toBeNull();
    expect(result!.html).toContain("User-42");
    expect(result!.html).not.toContain("lang=");
  });

  it("unknown path returns null", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/zh/nonexistent");
    expect(result).toBeNull();
  });
});

describe("router -- resolve with headers", () => {
  it("cookie resolves locale when no URL prefix", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/user/42", { cookie: "seam-locale=zh" });
    expect(result).not.toBeNull();
    expect(result!.html).toContain('lang="zh"');
    expect(result!.html).toContain("ZH User-42");
  });

  it("Accept-Language resolves locale when no URL prefix", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/user/42", { acceptLanguage: "zh-CN,zh;q=0.9" });
    expect(result).not.toBeNull();
    expect(result!.html).toContain('lang="zh"');
  });

  it("URL prefix beats cookie in default chain", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/en/user/42", { cookie: "seam-locale=zh" });
    expect(result).not.toBeNull();
    expect(result!.html).toContain('lang="en"');
    expect(result!.html).not.toContain("ZH");
  });

  it("cookie beats Accept-Language in default chain", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/user/42", {
      cookie: "seam-locale=zh",
      acceptLanguage: "en",
    });
    expect(result).not.toBeNull();
    expect(result!.html).toContain('lang="zh"');
  });

  it("no headers + no prefix -> default locale", async () => {
    const router = makeRouter(i18nConfig);
    const result = await router.handlePage("/user/42");
    expect(result).not.toBeNull();
    expect(result!.html).toContain('lang="en"');
  });

  it("custom resolveLocale overrides default chain", async () => {
    const custom: ResolveLocaleFn = () => "zh";
    const router = makeRouter(i18nConfig, custom);
    const result = await router.handlePage("/en/user/42", { cookie: "seam-locale=en" });
    expect(result).not.toBeNull();
    expect(result!.html).toContain('lang="zh"');
  });
});
