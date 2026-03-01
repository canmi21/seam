/* tests/e2e/specs/hydration.spec.ts */
import { test, expect, type ConsoleMessage } from "@playwright/test";

const ROUTES = ["/", "/react19"] as const;

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

function isHydrationPageError(error: Error): boolean {
  return HYDRATION_ERROR_PATTERNS.some((p) => error.message.includes(p));
}

test.describe("hydration", () => {
  test("data script uses custom data_id from config", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const scriptId = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/json"]');
      for (const s of scripts) if (s.id) return s.id;
      return null;
    });
    expect(scriptId).toBe("__e2e");
  });

  for (const route of ROUTES) {
    test(`no hydration errors on ${route}`, async ({ page }) => {
      const consoleErrors: ConsoleMessage[] = [];
      page.on("console", (msg) => {
        if (isHydrationError(msg)) consoleErrors.push(msg);
      });

      // React production builds throw uncaught errors instead of
      // calling console.error, so pageerror is needed to catch them.
      const pageErrors: Error[] = [];
      page.on("pageerror", (error) => {
        pageErrors.push(error);
      });

      await page.goto(route, { waitUntil: "networkidle" });

      // wait for React to mount inside the seam root
      await page
        .locator("#__seam")
        .locator(":scope > *")
        .first()
        .waitFor({ timeout: 5_000 })
        .catch(() => {
          /* root may already have children from SSR */
        });

      // short grace period for late errors
      await page.waitForTimeout(500);

      const hydrationPageErrors = pageErrors.filter(isHydrationPageError);
      const details = [
        ...consoleErrors.map((e) => e.text()),
        ...hydrationPageErrors.map((e) => e.message),
      ];
      expect(details, `hydration errors on ${route}`).toEqual([]);
    });
  }
});

test.describe("react 19 features", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/react19", { waitUntil: "networkidle" });
    await page
      .locator("#__seam")
      .locator(":scope > *")
      .first()
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    await page.waitForTimeout(500);
  });

  test("useId: label[for] matches input[id]", async ({ page }) => {
    const labels = page.locator("label[for]");
    const count = await labels.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i++) {
      const forAttr = await labels.nth(i).getAttribute("for");
      expect(forAttr).toBeTruthy();
      const input = page.locator(`input[id="${forAttr}"]`);
      await expect(input).toBeVisible();
    }
  });

  test("suspense content is visible", async ({ page }) => {
    await expect(page.getByTestId("suspense-content")).toBeVisible();
    await expect(page.getByTestId("suspense-content")).toContainText("loaded successfully");
  });

  test("interactive counter works after hydration", async ({ page }) => {
    const counter = page.getByTestId("counter-value");
    await expect(counter).toContainText("Count: 0");

    await page.getByTestId("increment-btn").click();
    await expect(counter).toContainText("Count: 1");

    await page.getByTestId("increment-btn").click();
    await expect(counter).toContainText("Count: 2");
  });

  test("metadata hoisting: document.title set by component", async ({ page }) => {
    const title = await page.title();
    expect(title).toBe("React 19 Features");
  });
});
