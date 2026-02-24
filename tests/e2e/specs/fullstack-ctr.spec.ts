/* tests/e2e/specs/fullstack-ctr.spec.ts */

import { test, expect } from "@playwright/test";
import { setupHydrationErrorCollector, waitForHydration } from "./helpers/hydration.js";

test.describe("fullstack CTR first-screen", () => {
  test("home page HTML contains server-rendered content", async ({ page }) => {
    const response = await page.goto("/", { waitUntil: "networkidle" });
    const html = await response!.text();

    expect(html).toContain("GitHub Dashboard");
    expect(html).toContain("Compile-Time Rendering for React");
    expect(html).toContain("Hello,");
    expect(html).toContain("__SEAM_DATA__");
  });

  test("dashboard page HTML contains GitHub user data with zero hydration errors", async ({
    page,
  }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    const response = await page.goto("/dashboard/octocat", { waitUntil: "networkidle" });
    const html = await response!.text();

    expect(html).toContain("octocat");
    expect(html).toContain("Top Repositories");
    expect(html).toContain("__SEAM_DATA__");

    // Verify __seam has content
    const rootContent = await page.locator("#__seam").innerHTML();
    expect(rootContent.length).toBeGreaterThan(0);

    await waitForHydration(page);
    expect(collectErrors(), "hydration errors on /dashboard/octocat").toEqual([]);
  });
});
