/* tests/e2e/specs/nextjs.spec.ts */

import { test, expect, type ConsoleMessage } from "@playwright/test";

/** Console message patterns that indicate real application errors. */
const ERROR_PATTERNS = [
  "Text content did not match",
  "Hydration failed",
  "An error occurred during hydration",
  "There was an error while hydrating",
  "Minified React error",
  "Unhandled Runtime Error",
];

/** Next.js dev-mode noise that is safe to ignore. */
const IGNORED_PATTERNS = [
  // Next.js dev overlay WebSocket and HMR messages
  "Download the React DevTools",
  "[HMR]",
  "Fast Refresh",
  // Chrome-specific
  "DevTools",
];

function isRealError(msg: ConsoleMessage): boolean {
  const text = msg.text();
  if (IGNORED_PATTERNS.some((p) => text.includes(p))) return false;
  if (msg.type() === "error") return true;
  if (msg.type() === "warning" && ERROR_PATTERNS.some((p) => text.includes(p))) return true;
  return false;
}

test.describe("Next.js SSR", () => {
  test("home page renders with correct content and zero console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (isRealError(msg)) errors.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

    await page.goto("/", { waitUntil: "networkidle" });

    await expect(page.locator("h1")).toContainText("GitHub Dashboard");
    await expect(page.locator("p")).toContainText("Next.js");
    await expect(page.locator('input[placeholder="GitHub username"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    expect(errors, "console errors on /").toEqual([]);
  });

  test("dashboard page renders GitHub user data with zero console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (isRealError(msg)) errors.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

    await page.goto("/dashboard/octocat", { waitUntil: "networkidle" });

    // Profile
    await expect(page.getByRole("heading", { name: "The Octocat" })).toBeVisible();
    await expect(page.locator("text=@octocat")).toBeVisible();

    // Stats
    await expect(page.getByText("Repos", { exact: true })).toBeVisible();
    await expect(page.getByText("Followers", { exact: true })).toBeVisible();

    // Repos section
    await expect(page.locator("h2")).toContainText("Top Repositories");

    // Footer
    await expect(page.locator("text=Next.js SSR")).toBeVisible();

    expect(errors, "console errors on /dashboard/octocat").toEqual([]);
  });

  test("form navigation works from home to dashboard", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (msg) => {
      if (isRealError(msg)) errors.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));

    await page.goto("/", { waitUntil: "networkidle" });
    await page.fill('input[placeholder="GitHub username"]', "octocat");
    await page.click('button[type="submit"]');
    await page.waitForURL("**/dashboard/octocat", { timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "The Octocat" })).toBeVisible();
    await expect(page.locator("h2")).toContainText("Top Repositories");

    expect(errors, "console errors during navigation").toEqual([]);
  });
});
