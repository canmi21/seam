/* tests/e2e/specs/error-boundary.spec.ts */
import { test, expect } from "@playwright/test";

test.describe("error boundary", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/error", { waitUntil: "networkidle" });
    // Wait for hydration
    await page
      .locator("#__SEAM_ROOT__")
      .locator(":scope > *")
      .first()
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("normal content visible on initial load", async ({ page }) => {
    await expect(page.getByTestId("normal-content")).toBeVisible();
  });

  test("clicking trigger-error shows error fallback", async ({ page }) => {
    await page.getByTestId("trigger-error").click();
    await expect(page.getByTestId("error-fallback")).toBeVisible({ timeout: 5_000 });
  });

  test("error fallback contains error text", async ({ page }) => {
    await page.getByTestId("trigger-error").click();
    await expect(page.getByTestId("error-fallback")).toContainText("error");
  });

  test("normal content hidden after error", async ({ page }) => {
    await page.getByTestId("trigger-error").click();
    await expect(page.getByTestId("error-fallback")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("normal-content")).not.toBeVisible();
  });
});
