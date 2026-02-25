/* tests/e2e/specs/workspace-assets.spec.ts */

import { test, expect } from "@playwright/test";

const ASSET_CSS_RE = /\/_seam\/static\/(?:style-)?[0-9a-f]+\.css/;
const ASSET_JS_RE = /\/_seam\/static\/(?:script-)?[0-9a-f]+\.js/;

test.describe("workspace production assets", () => {
  let html: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get("/");
    html = await res.text();
  });

  test("HTML contains hashed production assets, no dev-only scripts", () => {
    expect(html).toMatch(ASSET_CSS_RE);
    expect(html).toMatch(ASSET_JS_RE);

    expect(html).not.toContain("/@vite/client");
    expect(html).not.toContain("@react-refresh");
    expect(html).not.toContain("/_seam/dev/ws");
  });

  test("CSS asset returns 200 with correct content-type", async ({ request }) => {
    const cssUrl = html.match(ASSET_CSS_RE)![0];
    const res = await request.get(cssUrl);

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/css");
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  test("JS asset returns 200 with correct content-type", async ({ request }) => {
    const jsUrl = html.match(ASSET_JS_RE)![0];
    const res = await request.get(jsUrl);

    expect(res.status()).toBe(200);
    // application/javascript or text/javascript are both valid
    const ct = res.headers()["content-type"];
    expect(ct).toMatch(/javascript/);
    expect((await res.text()).length).toBeGreaterThan(0);
  });
});
