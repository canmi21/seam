/* tests/e2e/specs/fullstack-i18n.spec.ts */

import { test, expect } from "@playwright/test";
import { setupHydrationErrorCollector, waitForHydration } from "./helpers/hydration.js";
import fs from "node:fs";
import path from "node:path";

const seamToml = fs.readFileSync(
  path.resolve(__dirname, "../../../examples/github-dashboard/seam-app/seam.toml"),
  "utf-8",
);
const dataIdMatch = seamToml.match(/^data_id\s*=\s*"(.+)"/m);
const dataId = dataIdMatch?.[1] ?? "__SEAM_DATA__";

/** Extract _i18n and lang from the page */
async function getI18nState(page: import("@playwright/test").Page) {
  return page.evaluate((id: string) => {
    const el = document.getElementById(id);
    const data = el?.textContent ? JSON.parse(el.textContent) : {};
    return {
      lang: document.documentElement.getAttribute("lang"),
      i18n: data._i18n ?? null,
      hasOldI18nScript: !!document.getElementById("__seam_i18n"),
    };
  }, dataId);
}

test.describe("fullstack i18n locale routing", () => {
  test("default locale (/) serves English with lang=en", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    const response = await page.goto("/", { waitUntil: "networkidle" });
    const html = await response!.text();

    expect(html).toContain('lang="en"');
    expect(html).toContain("GitHub Dashboard");

    await waitForHydration(page);

    const state = await getI18nState(page);
    expect(state.lang).toBe("en");
    expect(state.i18n).not.toBeNull();
    expect(state.i18n.locale).toBe("en");
    expect(state.i18n.messages["dashboard.title"]).toBe("GitHub Dashboard");
    // All backends now inject _i18n at runtime; build-time fallback removed
    expect(state.hasOldI18nScript).toBe(false);
    expect(collectErrors(), "hydration errors on /").toEqual([]);
  });

  test("explicit /en/ serves same English content", async ({ page }) => {
    const response = await page.goto("/en/", { waitUntil: "networkidle" });
    const html = await response!.text();

    expect(html).toContain('lang="en"');
    expect(html).toContain("GitHub Dashboard");

    await waitForHydration(page);

    const state = await getI18nState(page);
    expect(state.lang).toBe("en");
    expect(state.i18n.locale).toBe("en");
  });

  test("/zh/ serves Chinese content with lang=zh", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    const response = await page.goto("/zh/", { waitUntil: "networkidle" });
    const html = await response!.text();

    expect(html).toContain('lang="zh"');

    await waitForHydration(page);

    // Translated title visible in the rendered page
    await expect(page.locator("h1")).toContainText("GitHub 仪表盘");

    const state = await getI18nState(page);
    expect(state.lang).toBe("zh");
    expect(state.i18n.locale).toBe("zh");
    expect(state.i18n.messages["dashboard.title"]).toBe("GitHub 仪表盘");
    expect(state.i18n.fallbackMessages).toBeTruthy();
    expect(state.i18n.fallbackMessages["dashboard.title"]).toBe("GitHub Dashboard");
    // All backends now inject _i18n at runtime; build-time fallback removed
    expect(state.hasOldI18nScript).toBe(false);
    expect(collectErrors(), "hydration errors on /zh/").toEqual([]);
  });

  test("/zh/dashboard/octocat serves Chinese dashboard page", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    const response = await page.goto("/zh/dashboard/octocat", { waitUntil: "networkidle" });
    const html = await response!.text();

    expect(html).toContain('lang="zh"');
    expect(html).toContain("octocat");

    await waitForHydration(page);

    const state = await getI18nState(page);
    expect(state.lang).toBe("zh");
    expect(state.i18n.locale).toBe("zh");
    expect(collectErrors(), "hydration errors on /zh/dashboard/octocat").toEqual([]);
  });

  test("English and Chinese home pages use different templates", async ({ page }) => {
    // English
    const enRes = await page.goto("/", { waitUntil: "networkidle" });
    const enHtml = await enRes!.text();

    // Chinese
    const zhRes = await page.goto("/zh/", { waitUntil: "networkidle" });
    const zhHtml = await zhRes!.text();

    // Both contain the data script but with different locale data
    expect(enHtml).toContain(dataId);
    expect(zhHtml).toContain(dataId);

    // The server-rendered HTML skeletons differ (locale-specific templates)
    expect(enHtml).not.toBe(zhHtml);
  });
});
