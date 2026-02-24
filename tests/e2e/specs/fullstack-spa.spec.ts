/* tests/e2e/specs/fullstack-spa.spec.ts */

import { test, expect } from "@playwright/test";
import { setupHydrationErrorCollector, waitForHydration } from "./helpers/hydration.js";

test.describe("fullstack SPA navigation", () => {
  test("form submit navigates to dashboard without full reload", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    await page.goto("/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    // Plant a marker on window — full reload destroys it
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__SPA_MARKER = true;
    });

    await page.fill('input[placeholder="GitHub username"]', "octocat");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard/octocat", { timeout: 15_000 });

    await expect(page.locator("h2")).toContainText("Top Repositories");

    const markerSurvived = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__SPA_MARKER === true,
    );
    expect(markerSurvived, "SPA marker lost — full reload occurred").toBe(true);

    expect(collectErrors(), "hydration errors during SPA navigation").toEqual([]);
  });

  test("back link returns to home without full reload", async ({ page }) => {
    await page.goto("/dashboard/octocat", { waitUntil: "networkidle" });
    await waitForHydration(page);

    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__SPA_MARKER = true;
    });

    await page.click('a[href="/"]');
    await page.waitForURL("**/");

    await expect(page.locator("h1")).toContainText("GitHub Dashboard");

    const markerSurvived = await page.evaluate(
      () => (window as unknown as Record<string, unknown>).__SPA_MARKER === true,
    );
    expect(markerSurvived, "SPA marker lost — full reload occurred").toBe(true);
  });
});
