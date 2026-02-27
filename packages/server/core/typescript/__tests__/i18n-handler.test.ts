/* packages/server/core/typescript/__tests__/i18n-handler.test.ts */

import { describe, expect, it } from "vitest";
import { handlePageRequest } from "../src/page/handler.js";
import type { PageDef, LayoutDef, I18nConfig } from "../src/page/index.js";
import { makeProcedures, mockProcedure, extractSeamData } from "./page-handler-helpers.js";

// Route hash for "/" — used to key messages in the new hash-based lookup
const ROOT_HASH = "2a0c975e";

const i18nConfig: I18nConfig = {
  locales: ["en", "zh"],
  default: "en",
  mode: "memory",
  cache: false,
  routeHashes: { "/": ROOT_HASH },
  contentHashes: {},
  messages: {
    en: { [ROOT_HASH]: { greeting: "Hello", cta: "View" } },
    zh: { [ROOT_HASH]: { greeting: "Hi zh", cta: "View zh" } },
  },
};

describe("handlePageRequest -- i18n data injection", () => {
  it("injects _i18n with server-merged messages for non-default locale", async () => {
    const page: PageDef = {
      template: "<body><h1><!--seam:page.title--></h1></body>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ title: "Hello" }))]);
    const result = await handlePageRequest(page, {}, procs, {
      locale: "zh",
      config: i18nConfig,
      routePattern: "/",
    });

    const data = extractSeamData(result.html);
    expect(data._i18n).toBeDefined();
    const i18n = data._i18n as Record<string, unknown>;
    expect(i18n.locale).toBe("zh");
    // Server pre-merges: en defaults + zh overrides
    expect(i18n.messages).toEqual({ greeting: "Hi zh", cta: "View zh" });
    expect(i18n).not.toHaveProperty("fallbackMessages");
  });

  it("injects correct messages for default locale", async () => {
    const page: PageDef = {
      template: "<body><p>hi</p></body>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs, {
      locale: "en",
      config: i18nConfig,
      routePattern: "/",
    });

    const data = extractSeamData(result.html);
    const i18n = data._i18n as Record<string, unknown>;
    expect(i18n.locale).toBe("en");
    expect(i18n.messages).toEqual({ greeting: "Hello", cta: "View" });
    expect(i18n).not.toHaveProperty("fallbackMessages");
  });

  it("returns pre-resolved messages (build-time fallback already applied)", async () => {
    // Build-time resolution means every locale has every key pre-resolved
    const resolvedConfig: I18nConfig = {
      locales: ["en", "zh"],
      default: "en",
      mode: "memory",
      cache: false,
      routeHashes: { "/": ROOT_HASH },
      contentHashes: {},
      messages: {
        en: { [ROOT_HASH]: { greeting: "Hello", cta: "View", extra: "Extra" } },
        zh: { [ROOT_HASH]: { greeting: "Hi zh", cta: "View", extra: "Extra" } },
      },
    };
    const page: PageDef = {
      template: "<body><p>hi</p></body>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs, {
      locale: "zh",
      config: resolvedConfig,
      routePattern: "/",
    });

    const data = extractSeamData(result.html);
    const i18n = data._i18n as Record<string, unknown>;
    // All keys present because build-time fallback resolved them
    expect(i18n.messages).toEqual({ greeting: "Hi zh", cta: "View", extra: "Extra" });
  });

  it("does not inject _i18n when i18nOpts absent (backward compat)", async () => {
    const page: PageDef = {
      template: "<body><p>hi</p></body>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs);

    const data = extractSeamData(result.html);
    expect(data._i18n).toBeUndefined();
  });

});

describe("handlePageRequest -- i18n html lang attribute", () => {
  it("sets <html lang> attribute when locale provided", async () => {
    const page: PageDef = {
      template: "<html><body><p>hi</p></body></html>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs, {
      locale: "zh",
      config: i18nConfig,
      routePattern: "/",
    });

    expect(result.html).toContain('<html lang="zh"');
  });

  it("does not modify <html> when no i18nOpts", async () => {
    const page: PageDef = {
      template: "<html><body><p>hi</p></body></html>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs);

    expect(result.html).toContain("<html>");
    expect(result.html).not.toContain("lang=");
  });
});

describe("handlePageRequest -- i18n template selection", () => {
  it("selects locale-specific template via localeTemplates", async () => {
    const page: PageDef = {
      template: "<body><p>English</p></body>",
      localeTemplates: {
        en: "<body><p>English</p></body>",
        zh: "<body><p>Chinese</p></body>",
      },
      loaders: {},
      layoutChain: [],
    };
    const procs = makeProcedures();
    const result = await handlePageRequest(page, {}, procs, {
      locale: "zh",
      config: i18nConfig,
      routePattern: "/",
    });

    expect(result.html).toContain("<p>Chinese</p>");
    expect(result.html).not.toContain("<p>English</p>");
  });

  it("falls back to default template for unknown locale", async () => {
    const page: PageDef = {
      template: "<body><p>Default</p></body>",
      localeTemplates: {
        en: "<body><p>English</p></body>",
      },
      loaders: {},
      layoutChain: [],
    };
    const procs = makeProcedures();
    const result = await handlePageRequest(page, {}, procs, {
      locale: "fr",
      config: { ...i18nConfig, locales: ["en", "fr"] },
      routePattern: "/",
    });

    expect(result.html).toContain("<p>Default</p>");
  });

  it("selects locale-specific layout template", async () => {
    const layout: LayoutDef = {
      id: "root",
      template: "<html><body><nav>EN Nav</nav><!--seam:outlet--></body></html>",
      localeTemplates: {
        en: "<html><body><nav>EN Nav</nav><!--seam:outlet--></body></html>",
        zh: "<html><body><nav>ZH Nav</nav><!--seam:outlet--></body></html>",
      },
      loaders: {},
    };
    const page: PageDef = {
      template: "<p>EN Content</p>",
      localeTemplates: {
        en: "<p>EN Content</p>",
        zh: "<p>ZH Content</p>",
      },
      loaders: {},
      layoutChain: [layout],
    };
    const procs = makeProcedures();
    const result = await handlePageRequest(page, {}, procs, {
      locale: "zh",
      config: i18nConfig,
      routePattern: "/",
    });

    expect(result.html).toContain("<nav>ZH Nav</nav>");
    expect(result.html).toContain("<p>ZH Content</p>");
    expect(result.html).not.toContain("EN Nav");
    expect(result.html).not.toContain("EN Content");
  });
});
