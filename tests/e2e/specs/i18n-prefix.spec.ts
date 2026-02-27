/* tests/e2e/specs/i18n-prefix.spec.ts */

import { test, expect } from "@playwright/test";
import { setupHydrationErrorCollector, waitForHydration } from "./helpers/hydration.js";

test.describe("i18n prefix mode", () => {
  test("default locale is English with lang attribute", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    await page.goto("/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    const lang = await page.locator("html").getAttribute("lang");
    expect(lang).toBe("en");

    await expect(page.locator("h1")).toContainText("i18n Demo");
    await expect(page.locator("nav")).toContainText("Home");
    expect(collectErrors(), "hydration errors on /").toEqual([]);
  });

  test("/zh/ renders Chinese content", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    await page.goto("/zh/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    const lang = await page.locator("html").getAttribute("lang");
    expect(lang).toBe("zh");

    await expect(page.locator("h1")).toContainText("i18n 演示");
    await expect(page.locator("nav")).toContainText("首页");
    expect(collectErrors(), "hydration errors on /zh/").toEqual([]);
  });

  test("/zh/about renders Chinese about page", async ({ page }) => {
    await page.goto("/zh/about", { waitUntil: "networkidle" });
    await waitForHydration(page);

    const lang = await page.locator("html").getAttribute("lang");
    expect(lang).toBe("zh");

    await expect(page.locator("h1")).toContainText("关于");
  });

  test("locale switcher navigates to prefixed URL", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    // Click locale switcher (should show "ZH" when current is English)
    await page.click("button:has-text('ZH')");

    // Should navigate to /zh/
    await page.waitForURL("**/zh/", { timeout: 10_000 });

    const lang = await page.locator("html").getAttribute("lang");
    expect(lang).toBe("zh");

    await expect(page.locator("h1")).toContainText("i18n 演示");
  });

  test("SPA navigation preserves locale prefix", async ({ page }) => {
    await page.goto("/zh/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    // Plant SPA marker
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__SPA_MARKER = true;
    });

    // Click About link
    await page.click('a:has-text("关于")');
    await page.waitForURL("**/zh/about", { timeout: 10_000 });

    await expect(page.locator("h1")).toContainText("关于");

    // Verify SPA navigation (no full reload)
    const markerSurvived = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__SPA_MARKER === true,
    );
    expect(markerSurvived, "SPA marker lost — full reload occurred").toBe(true);
  });
});
