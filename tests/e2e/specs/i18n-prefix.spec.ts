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
});

test.describe("i18n prefix mode — cache and SPA", () => {
  test("first screen injects only current page keys", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    const keys = await page.evaluate(() => {
      const el = document.getElementById("__SEAM_DATA__");
      if (!el) return [];
      const data = JSON.parse(el.textContent || "{}");
      return Object.keys(data._i18n?.messages ?? {});
    });

    // Home page: should have home.* keys (page) and nav.* keys (layout)
    expect(keys).toContain("home.title");
    expect(keys).toContain("nav.home");
    // Should NOT have about-page-only keys
    expect(keys).not.toContain("about.title");
    expect(keys).not.toContain("about.description");
  });

  test("cache enabled injects hash and router in _i18n", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    const i18n = await page.evaluate(() => {
      const el = document.getElementById("__SEAM_DATA__");
      if (!el) return null;
      const data = JSON.parse(el.textContent || "{}");
      return data._i18n;
    });

    expect(i18n).toBeTruthy();
    expect(i18n.hash).toBeTruthy();
    expect(i18n.router).toBeTruthy();
    expect(typeof i18n.hash).toBe("string");
    expect(typeof i18n.router).toBe("object");
  });

  test("SPA navigation triggers RPC on cache miss", async ({ page }) => {
    await page.goto("/zh/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    const rpcCalls: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/_seam/procedure/")) {
        const body = req.postData() || "";
        if (body.includes("__seam_i18n_query")) rpcCalls.push(body);
      }
    });

    // SPA navigate to about page (cache miss — first visit)
    await page.click('a:has-text("关于")');
    await page.waitForURL("**/zh/about", { timeout: 10_000 });
    await expect(page.locator("h1")).toContainText("关于");

    expect(rpcCalls.length, "expected RPC call for cache miss").toBeGreaterThan(0);
  });

  test("SPA navigation skips RPC on cache hit", async ({ page }) => {
    await page.goto("/zh/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    // First visit to about (cache miss — populates cache)
    await page.click('a:has-text("关于")');
    await page.waitForURL("**/zh/about", { timeout: 10_000 });
    await expect(page.locator("h1")).toContainText("关于");

    // Navigate back to home
    await page.click('a:has-text("首页")');
    await page.waitForURL("**/zh/", { timeout: 10_000 });

    // Start listening for RPC AFTER cache is populated
    const rpcCalls: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("/_seam/procedure/")) {
        const body = req.postData() || "";
        if (body.includes("__seam_i18n_query")) rpcCalls.push(body);
      }
    });

    // Second visit to about (should be cache hit)
    await page.click('a:has-text("关于")');
    await page.waitForURL("**/zh/about", { timeout: 10_000 });
    await expect(page.locator("h1")).toContainText("关于");

    // Short wait to ensure no delayed RPC
    await page.waitForTimeout(500);
    expect(rpcCalls.length, "expected zero RPC calls on cache hit").toBe(0);
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
