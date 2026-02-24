/* tests/e2e/specs/helpers/hydration.ts */

import type { Page, ConsoleMessage } from "@playwright/test";

export const HYDRATION_ERROR_PATTERNS = [
  "Text content did not match",
  "Hydration failed",
  "An error occurred during hydration",
  "There was an error while hydrating",
  "Minified React error #418",
  "Minified React error #423",
  "Minified React error #425",
];

/**
 * Attach console + pageerror listeners that capture hydration errors.
 * Returns a function that collects all captured error messages.
 */
export function setupHydrationErrorCollector(page: Page): () => string[] {
  const consoleErrors: ConsoleMessage[] = [];
  const pageErrors: Error[] = [];

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (HYDRATION_ERROR_PATTERNS.some((p) => text.includes(p))) {
      consoleErrors.push(msg);
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error);
  });

  return () => [
    ...consoleErrors.map((e) => e.text()),
    ...pageErrors
      .filter((e) => HYDRATION_ERROR_PATTERNS.some((p) => e.message.includes(p)))
      .map((e) => e.message),
  ];
}

/** Wait for hydration: root content rendered + 500ms grace period. */
export async function waitForHydration(page: Page): Promise<void> {
  await page
    .locator("#__seam")
    .locator(":scope > *")
    .first()
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  await page.waitForTimeout(500);
}
