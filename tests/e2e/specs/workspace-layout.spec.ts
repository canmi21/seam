/* tests/e2e/specs/workspace-layout.spec.ts */

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

test.describe("workspace layout", () => {
  test("layout renders session data from procedure", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    await expect(page.getByText("Hello,")).toBeVisible();
    await expect(page.locator("body")).toContainText("Hello,");
  });

  test("layout session data injected with _layouts structure", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    const seamData = await page.evaluate((id: string) => {
      const el = document.getElementById(id);
      if (!el?.textContent) return null;
      try {
        return JSON.parse(el.textContent);
      } catch {
        return null;
      }
    }, dataId);

    expect(seamData).not.toBeNull();
    expect(seamData._layouts).toBeDefined();
    expect(seamData._layouts._layout_root).toBeDefined();
    expect(seamData._layouts._layout_root.session).toBeDefined();
    expect(seamData._layouts._layout_root.session.username).toBeTruthy();
  });

  test("dashboard page data script separates page vs layout data", async ({ page }) => {
    await page.goto("/dashboard/octocat", { waitUntil: "networkidle" });

    const seamData = await page.evaluate((id: string) => {
      const el = document.getElementById(id);
      if (!el?.textContent) return null;
      try {
        return JSON.parse(el.textContent);
      } catch {
        return null;
      }
    }, dataId);

    expect(seamData).not.toBeNull();
    // Page-level data at top level
    expect(seamData.user).toBeDefined();
    expect(seamData.repos).toBeDefined();
    // Layout data under _layouts
    expect(seamData._layouts).toBeDefined();
    expect(seamData._layouts._layout_root.session).toBeDefined();
  });

  test("layout DOM persists across SPA navigation", async ({ page }) => {
    const collectErrors = setupHydrationErrorCollector(page);

    await page.goto("/", { waitUntil: "networkidle" });
    await waitForHydration(page);

    // Stamp the layout root node
    await page.evaluate(() => {
      const layout = document.querySelector("#__seam > div") as HTMLElement;
      if (layout) layout.dataset.spaStamp = "layout-alive";
    });

    await page.fill('input[placeholder="GitHub username"]', "octocat");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard/octocat", { timeout: 15_000 });
    await waitForHydration(page);

    const stampSurvived = await page.evaluate(() => {
      const layout = document.querySelector("#__seam > div") as HTMLElement;
      return layout?.dataset.spaStamp;
    });
    expect(stampSurvived, "layout DOM re-mounted during SPA navigation").toBe("layout-alive");

    expect(collectErrors(), "hydration errors during layout navigation").toEqual([]);
  });
});
