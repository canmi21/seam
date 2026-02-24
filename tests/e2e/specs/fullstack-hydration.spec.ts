/* tests/e2e/specs/fullstack-hydration.spec.ts */

import { test, expect } from "@playwright/test";
import { waitForHydration } from "./helpers/hydration.js";

test.describe("fullstack hydration interaction", () => {
  test("DarkModeToggle works and layout DOM persists across SPA nav", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    // Toggle dark mode
    await page.click('button[aria-label="Toggle dark mode"]');
    const hasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    expect(hasDark, "dark class not toggled on <html>").toBe(true);

    // Stamp the layout root node — React re-mount destroys it
    await page.evaluate(() => {
      const layout = document.querySelector("#__seam > div") as HTMLElement;
      layout.dataset.spaStamp = "layout-alive";
    });

    // Navigate to dashboard via form submit
    await page.fill('input[placeholder="GitHub username"]', "octocat");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard/octocat", { timeout: 15_000 });
    await waitForHydration(page);

    // Layout root should survive SPA navigation (not re-mounted)
    const stampSurvived = await page.evaluate(() => {
      const layout = document.querySelector("#__seam > div") as HTMLElement;
      return layout?.dataset.spaStamp;
    });
    expect(stampSurvived, "layout DOM re-mounted during SPA navigation").toBe("layout-alive");

    // DarkModeToggle should still be visible
    await expect(page.locator('button[aria-label="Toggle dark mode"]')).toBeVisible();
  });
});
