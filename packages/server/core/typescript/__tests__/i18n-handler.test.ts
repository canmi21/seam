/* packages/server/core/typescript/__tests__/i18n-handler.test.ts */

import { describe, expect, it } from "vitest";
import { handlePageRequest } from "../src/page/handler.js";
import type { PageDef, LayoutDef, I18nConfig } from "../src/page/index.js";
import { makeProcedures, mockProcedure, extractSeamData } from "./page-handler-helpers.js";

const i18nConfig: I18nConfig = {
  locales: ["en", "zh"],
  default: "en",
  messages: {
    en: { greeting: "Hello", cta: "View" },
    zh: { greeting: "Hi zh", cta: "View zh" },
  },
};

describe("handlePageRequest -- i18n", () => {
  it("injects _i18n into seamData when i18nOpts provided", async () => {
    const page: PageDef = {
      template: "<body><h1><!--seam:page.title--></h1></body>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ title: "Hello" }))]);
    const result = await handlePageRequest(page, {}, procs, {
      locale: "zh",
      config: i18nConfig,
    });

    const data = extractSeamData(result.html);
    expect(data._i18n).toBeDefined();
    const i18n = data._i18n as Record<string, unknown>;
    expect(i18n.locale).toBe("zh");
    expect(i18n.messages).toEqual({ greeting: "Hi zh", cta: "View zh" });
    expect(i18n.fallbackMessages).toEqual({ greeting: "Hello", cta: "View" });
  });

  it("does not include fallbackMessages for default locale", async () => {
    const page: PageDef = {
      template: "<body><p>hi</p></body>",
      loaders: { page: () => ({ procedure: "getData", input: {} }) },
      layoutChain: [],
    };
    const procs = makeProcedures(["getData", mockProcedure(() => ({ v: 1 }))]);
    const result = await handlePageRequest(page, {}, procs, {
      locale: "en",
      config: i18nConfig,
    });

    const data = extractSeamData(result.html);
    const i18n = data._i18n as Record<string, unknown>;
    expect(i18n.locale).toBe("en");
    expect(i18n.fallbackMessages).toBeUndefined();
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
    });

    expect(result.html).toContain("<nav>ZH Nav</nav>");
    expect(result.html).toContain("<p>ZH Content</p>");
    expect(result.html).not.toContain("EN Nav");
    expect(result.html).not.toContain("EN Content");
  });
});
