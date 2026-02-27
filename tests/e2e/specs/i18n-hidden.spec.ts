/* tests/e2e/specs/i18n-hidden.spec.ts */

import { test, expect } from "@playwright/test";
import { setupHydrationErrorCollector, waitForHydration } from "./helpers/hydration.js";

test.describe("i18n hidden mode", () => {
  test("default locale is English without prefix", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    await page.goto("/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    const lang = await page.locator("html").getAttribute("lang");
    expect(lang).toBe("en");

    await expect(page.locator("h1")).toContainText("i18n Demo");
    expect(page.url()).not.toContain("/en");
    expect(collectErrors(), "hydration errors on /").toEqual([]);
  });

  test("?lang=zh renders Chinese and URL is cleaned", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    await page.goto("/?lang=zh", { waitUntil: "networkidle" });
    await waitForHydration(page);

    const lang = await page.locator("html").getAttribute("lang");
    expect(lang).toBe("zh");

    await expect(page.locator("h1")).toContainText("i18n 演示");

    // cleanLocaleQuery should have stripped ?lang=zh
    const url = new URL(page.url());
    expect(url.searchParams.has("lang")).toBe(false);

    expect(collectErrors(), "hydration errors on /?lang=zh").toEqual([]);
  });

  test("?lang=zh&foo=bar preserves other query params", async ({ page }) => {
    await page.goto("/?lang=zh&foo=bar", { waitUntil: "networkidle" });
    await waitForHydration(page);

    await expect(page.locator("h1")).toContainText("i18n 演示");

    // lang stripped, foo preserved
    const url = new URL(page.url());
    expect(url.searchParams.has("lang")).toBe(false);
    expect(url.searchParams.get("foo")).toBe("bar");
  });

  test("locale switcher writes cookie and switches content", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    // Should be English initially
    await expect(page.locator("h1")).toContainText("i18n Demo");

    // Click locale switcher to switch to Chinese
    await page.click("button:has-text('ZH')");

    // Page reloads with cookie, should now be Chinese
    await page.waitForLoadState("networkidle");
    await waitForHydration(page);

    await expect(page.locator("h1")).toContainText("i18n 演示");

    // URL should not have locale prefix (hidden mode)
    expect(page.url()).not.toMatch(/\/zh/);
  });

  test("cookie persists locale across SPA navigation", async ({ page }) => {
    // Set cookie to Chinese via query param first
    await page.goto("/?lang=zh", { waitUntil: "networkidle" });
    await waitForHydration(page);

    // Switch locale to set cookie (to Chinese)
    // Already Chinese from query, click EN to toggle, then ZH to confirm cookie write
    // Actually, let's use switchLocale directly — just navigate with cookie
    await page.click("button:has-text('EN')");
    await page.waitForLoadState("networkidle");
    await waitForHydration(page);

    // Now English via cookie
    await expect(page.locator("h1")).toContainText("i18n Demo");

    // Navigate to about via SPA
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__SPA_MARKER = true;
    });

    await page.click('a:has-text("About")');
    await page.waitForURL("**/about", { timeout: 10_000 });

    await expect(page.locator("h1")).toContainText("About");

    // Verify SPA navigation (no full reload)
    const markerSurvived = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__SPA_MARKER === true,
    );
    expect(markerSurvived, "SPA marker lost — full reload occurred").toBe(true);
  });
});
