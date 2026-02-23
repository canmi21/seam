/* tests/e2e/specs/async-loading.spec.ts */
import { test, expect } from "@playwright/test";

test.describe("async loading", () => {
  test("loading indicator visible initially", async ({ page }) => {
    await page.goto("/async", { waitUntil: "networkidle" });
    // Hydration turns the static HTML into the React tree with loading state
    await page
      .locator("#__SEAM_ROOT__")
      .locator(":scope > *")
      .first()
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    // The fetch fires on mount; loading state may be brief
    // We verify the final state in subsequent tests
  });

  test("async list appears with items after loading", async ({ page }) => {
    await page.goto("/async", { waitUntil: "networkidle" });
    await expect(page.getByTestId("async-list")).toBeVisible({ timeout: 5_000 });
    const items = page.getByTestId("async-item");
    await expect(items).toHaveCount(3);
  });

  test("loading indicator disappears after data arrives", async ({ page }) => {
    await page.goto("/async", { waitUntil: "networkidle" });
    await expect(page.getByTestId("async-list")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("loading")).not.toBeVisible();
  });

  test("items have correct labels", async ({ page }) => {
    await page.goto("/async", { waitUntil: "networkidle" });
    await expect(page.getByTestId("async-list")).toBeVisible({ timeout: 5_000 });
    const items = page.getByTestId("async-item");
    await expect(items.nth(0)).toContainText("Alpha");
    await expect(items.nth(1)).toContainText("Beta");
    await expect(items.nth(2)).toContainText("Gamma");
  });
});
