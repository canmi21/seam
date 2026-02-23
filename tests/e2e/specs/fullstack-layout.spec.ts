/* tests/e2e/specs/fullstack-layout.spec.ts */
import { test, expect, type ConsoleMessage } from "@playwright/test";

const HYDRATION_ERROR_PATTERNS = [
  "Text content did not match",
  "Hydration failed",
  "An error occurred during hydration",
  "There was an error while hydrating",
  "Minified React error #418",
  "Minified React error #423",
  "Minified React error #425",
];

function isHydrationError(msg: ConsoleMessage): boolean {
  if (msg.type() !== "error") return false;
  const text = msg.text();
  return HYDRATION_ERROR_PATTERNS.some((p) => text.includes(p));
}

test.describe("fullstack layout", () => {
  test("layout renders session data from procedure", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Layout should render session.username from getSession procedure
    await expect(page.getByText("Hello,")).toBeVisible();
    // The username comes from the real getSession procedure
    await expect(page.locator("body")).toContainText("Hello,");
  });

  test("no hydration errors on home page with layout", async ({ page }) => {
    const consoleErrors: ConsoleMessage[] = [];
    page.on("console", (msg) => {
      if (isHydrationError(msg)) consoleErrors.push(msg);
    });

    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error);
    });

    await page.goto("/", { waitUntil: "networkidle" });

    await page
      .locator("#__SEAM_ROOT__")
      .locator(":scope > *")
      .first()
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    await page.waitForTimeout(500);

    const hydrationPageErrors = pageErrors.filter((e) =>
      HYDRATION_ERROR_PATTERNS.some((p) => e.message.includes(p)),
    );
    const details = [
      ...consoleErrors.map((e) => e.text()),
      ...hydrationPageErrors.map((e) => e.message),
    ];
    expect(details, "hydration errors on /").toEqual([]);
  });

  test("layout session data injected in page data", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });

    // Extract __SEAM_DATA__ from the inline script
    const seamData = await page.evaluate(() => {
      const scripts = document.querySelectorAll("script");
      for (const s of scripts) {
        if (s.textContent && s.textContent.includes("_layouts")) {
          try {
            return JSON.parse(s.textContent);
          } catch {
            // not JSON, skip
          }
        }
      }
      return null;
    });

    expect(seamData).not.toBeNull();
    expect(seamData._layouts).toBeDefined();
    expect(seamData._layouts._layout_root).toBeDefined();
    expect(seamData._layouts._layout_root.session).toBeDefined();
    expect(seamData._layouts._layout_root.session.username).toBeTruthy();
  });
});
