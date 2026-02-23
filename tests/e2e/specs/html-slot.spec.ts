/* tests/e2e/specs/html-slot.spec.ts */
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

test.describe("html slot injection", () => {
  test("html slot value is inserted as raw HTML, not escaped", async ({ page }) => {
    const response = await page.goto("/test-html", { waitUntil: "networkidle" });
    const html = await response!.text();

    // The raw HTML tags must appear in the response body (not escaped)
    expect(html).toContain("<h2>Hello from <em>HTML slot</em></h2>");
    expect(html).toContain("<strong>not</strong>");

    // Must NOT contain escaped versions
    expect(html).not.toContain("&lt;h2&gt;");
    expect(html).not.toContain("&lt;em&gt;");
  });

  test("text slot value is escaped as plain text", async ({ page }) => {
    const response = await page.goto("/test-html", { waitUntil: "networkidle" });
    const html = await response!.text();

    // Title is a text slot — should appear as plain text inside h1
    expect(html).toContain('<h1 data-testid="title">Test Post</h1>');
  });

  test("html and text slots coexist correctly on the same page", async ({ page }) => {
    await page.goto("/test-html", { waitUntil: "networkidle" });

    // Text slot: title rendered as text
    const title = page.getByTestId("title");
    await expect(title).toHaveText("Test Post");

    // HTML slot: body contains rendered HTML elements
    const body = page.getByTestId("body");
    await expect(body.locator("h2")).toHaveText("Hello from HTML slot");
    await expect(body.locator("em")).toHaveText("HTML slot");
    await expect(body.locator("strong")).toHaveText("not");
  });

  test("no hydration errors on /test-html", async ({ page }) => {
    const consoleErrors: ConsoleMessage[] = [];
    page.on("console", (msg) => {
      if (isHydrationError(msg)) consoleErrors.push(msg);
    });

    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error);
    });

    await page.goto("/test-html", { waitUntil: "networkidle" });

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
    expect(details, "hydration errors on /test-html").toEqual([]);
  });
});
