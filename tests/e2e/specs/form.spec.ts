/* tests/e2e/specs/form.spec.ts */
import { test, expect } from "@playwright/test";

test.describe("form interaction", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/form", { waitUntil: "networkidle" });
    // Wait for hydration
    await page
      .locator("#__seam")
      .locator(":scope > *")
      .first()
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("form renders with inputs and submit button", async ({ page }) => {
    await expect(page.getByTestId("form")).toBeVisible();
    await expect(page.getByTestId("name-input")).toBeVisible();
    await expect(page.getByTestId("email-input")).toBeVisible();
    await expect(page.getByTestId("submit-btn")).toBeVisible();
  });

  test("submit valid data shows success message", async ({ page }) => {
    await page.getByTestId("name-input").fill("Alice");
    await page.getByTestId("email-input").fill("alice@example.com");
    await page.getByTestId("submit-btn").click();
    await expect(page.getByTestId("success-msg")).toBeVisible({ timeout: 5_000 });
  });

  test("success message contains submitted name", async ({ page }) => {
    await page.getByTestId("name-input").fill("Bob");
    await page.getByTestId("email-input").fill("bob@example.com");
    await page.getByTestId("submit-btn").click();
    await expect(page.getByTestId("success-msg")).toContainText("Bob");
  });

  test("submit with empty fields shows error", async ({ page }) => {
    // Clear inputs and submit empty form — RPC validation rejects missing fields
    await page.getByTestId("submit-btn").click();
    await expect(page.getByTestId("error-msg")).toBeVisible({ timeout: 5_000 });
  });
});
