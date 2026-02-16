/* tests/e2e/specs/hydration.spec.ts */
import { test, expect, type ConsoleMessage } from "@playwright/test";

const ROUTES = ["/", "/about", "/posts"] as const;

// Routes with known hydration mismatches (template <ul> duplication,
// comment node differences). Remove entries as mismatches are fixed.
const KNOWN_FAILURES = new Set<string>(["/", "/posts"]);

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
  for (const route of ROUTES) {
    test(`no hydration errors on ${route}`, async ({ page }) => {
      if (KNOWN_FAILURES.has(route)) test.fail();

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
        .locator("#__SEAM_ROOT__")
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
