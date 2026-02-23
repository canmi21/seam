/* tests/e2e/specs/navigation.spec.ts */
import { test, expect } from "@playwright/test";

test.describe("navigation", () => {
  test("home page renders with nav links", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toContainText("E2E Fixture");
    await expect(page.getByTestId("link-react19")).toBeVisible();
    await expect(page.getByTestId("link-form")).toBeVisible();
    await expect(page.getByTestId("link-error")).toBeVisible();
    await expect(page.getByTestId("link-async")).toBeVisible();
  });

  test("click link to /react19 loads the page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByTestId("link-react19").click();
    await page.waitForURL("/react19");
    await expect(page.locator("h1")).toContainText("React 19 Features");
  });

  test("click link to /form loads the page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByTestId("link-form").click();
    await page.waitForURL("/form");
    await expect(page.getByTestId("form")).toBeVisible();
  });

  test("click link to /error loads the page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByTestId("link-error").click();
    await page.waitForURL("/error");
    await expect(page.getByTestId("normal-content")).toBeVisible();
  });

  test("click link to /async loads the page", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByTestId("link-async").click();
    await page.waitForURL("/async");
    await expect(page.locator("h1")).toContainText("Async Loading Test");
  });

  test("non-existent route returns 404", async ({ page }) => {
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBe(404);
  });

  test("back link from sub-pages returns to home", async ({ page }) => {
    await page.goto("/form", { waitUntil: "networkidle" });
    await page.getByTestId("link-home").click();
    await page.waitForURL("/");
    await expect(page.locator("h1")).toContainText("E2E Fixture");
  });
});
