/* tests/e2e/specs/workspace-ctr.spec.ts */

import { test, expect } from "@playwright/test";
import { setupHydrationErrorCollector, waitForHydration } from "./helpers/hydration.js";
import fs from "node:fs";
import path from "node:path";

const seamToml = fs.readFileSync(
  path.resolve(__dirname, "../../../examples/github-dashboard/seam-app/seam.toml"),
  "utf-8",
);
const dataIdMatch = seamToml.match(/^data_id\s*=\s*"(.+)"/m);
const dataId = dataIdMatch?.[1] ?? "__data";

test.describe("workspace CTR first-screen", () => {
  test("home page HTML contains server-rendered content", async ({ page }) => {
    const response = await page.goto("/", { waitUntil: "networkidle" });
    const html = await response!.text();

    expect(html).toContain("GitHub Dashboard");
    expect(html).toContain("Compile-Time Rendering for React");
    expect(html).toContain("Hello,");
    expect(html).toContain(dataId);
  });

  test("dashboard page renders GitHub user data with zero hydration errors", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    const response = await page.goto("/dashboard/octocat", { waitUntil: "networkidle" });
    const html = await response!.text();

    expect(html).toContain("octocat");
    expect(html).toContain("Top Repositories");
    expect(html).toContain(dataId);

    const rootContent = await page.locator("#__seam").innerHTML();
    expect(rootContent.length).toBeGreaterThan(0);

    await waitForHydration(page);
    expect(collectErrors(), "hydration errors on /dashboard/octocat").toEqual([]);
  });

  test("home page has zero hydration errors", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    await page.goto("/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    expect(collectErrors(), "hydration errors on /").toEqual([]);
  });
});
