/* tests/e2e/specs/fullstack-assets.spec.ts */

import { test, expect } from "@playwright/test";

// Matches both type_hint formats: "style-{hash}.css" or "{hash}.css"
const ASSET_CSS_RE = /\/_seam\/static\/(?:style-)?[0-9a-f]+\.css/;
const ASSET_JS_RE = /\/_seam\/static\/(?:script-)?[0-9a-f]+\.js/;
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

test.describe("production assets", () => {
  let html: string;

  test.beforeAll(async ({ request }) => {
    const res = await request.get("/");
    html = await res.text();
  });

  test("HTML contains hashed production assets, no dev-only scripts", () => {
    expect(html).toMatch(ASSET_CSS_RE);
    expect(html).toMatch(ASSET_JS_RE);

    // Dev-only markers must be absent
    expect(html).not.toContain("/@vite/client");
    expect(html).not.toContain("@react-refresh");
    expect(html).not.toContain("/_seam/dev/ws");

    // RPC hash map must not be exposed in production HTML
    expect(html).not.toContain("__SEAM_RPC_MAP__");
  });

  test("CSS asset returns 200 with immutable cache", async ({ request }) => {
    const cssUrl = html.match(ASSET_CSS_RE)![0];
    const res = await request.get(cssUrl);

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/css");
    expect(res.headers()["cache-control"]).toBe(IMMUTABLE_CACHE);
    expect((await res.text()).length).toBeGreaterThan(0);
  });

  test("JS asset returns 200 with immutable cache", async ({ request }) => {
    const jsUrl = html.match(ASSET_JS_RE)![0];
    const res = await request.get(jsUrl);

    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("application/javascript");
    expect(res.headers()["cache-control"]).toBe(IMMUTABLE_CACHE);
    expect((await res.text()).length).toBeGreaterThan(0);
  });
});
