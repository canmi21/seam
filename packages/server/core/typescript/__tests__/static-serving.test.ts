/* packages/server/core/typescript/__tests__/static-serving.test.ts */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRouter, t, createHttpHandler } from "../src/index.js";

const router = createRouter({
  greet: {
    input: t.object({ name: t.string() }),
    output: t.object({ message: t.string() }),
    handler: ({ input }) => ({ message: `Hello, ${input.name}!` }),
  },
});

let staticDir: string;

beforeAll(() => {
  staticDir = mkdtempSync(join(tmpdir(), "seam-static-test-"));
  mkdirSync(join(staticDir, "sub"), { recursive: true });
  writeFileSync(join(staticDir, "main-abc.js"), "console.log('hello')");
  writeFileSync(join(staticDir, "style-xyz.css"), "body { color: red }");
  writeFileSync(join(staticDir, "sub/nested.js"), "export default 1");
  writeFileSync(join(staticDir, "data.bin"), "binary content");
  writeFileSync(join(staticDir, "font.woff2"), "fake woff2");
});

afterAll(() => {
  rmSync(staticDir, { recursive: true, force: true });
});

function makeHandler() {
  return createHttpHandler(router, { staticDir });
}

function req(handler: ReturnType<typeof makeHandler>, method: string, url: string) {
  return handler({
    method,
    url: `http://localhost${url}`,
    body: () => Promise.reject(new Error("no body")),
  });
}

describe("static asset serving", () => {
  it("serves JS files with correct content type", async () => {
    const handler = makeHandler();
    const res = await req(handler, "GET", "/_seam/static/main-abc.js");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/javascript");
    expect(res.headers["Cache-Control"]).toContain("immutable");
    expect(res.body).toBe("console.log('hello')");
  });

  it("serves CSS files with correct content type", async () => {
    const handler = makeHandler();
    const res = await req(handler, "GET", "/_seam/static/style-xyz.css");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("text/css");
  });

  it("serves nested files", async () => {
    const handler = makeHandler();
    const res = await req(handler, "GET", "/_seam/static/sub/nested.js");
    expect(res.status).toBe(200);
    expect(res.body).toBe("export default 1");
  });

  it("returns 404 for missing assets", async () => {
    const handler = makeHandler();
    const res = await req(handler, "GET", "/_seam/static/nope.js");
    expect(res.status).toBe(404);
  });

  it("rejects directory traversal via URL normalization", async () => {
    // URL parser normalizes `..` before our code sees it, so it falls through to 404
    const handler = makeHandler();
    const res = await req(handler, "GET", "/_seam/static/../../../etc/passwd");
    expect(res.status).toBe(404);
  });

  it("rejects path with encoded traversal attempt", async () => {
    const handler = makeHandler();
    const res = await handler({
      method: "GET",
      url: "http://localhost/_seam/static/..%2F..%2Fetc/passwd",
      body: () => Promise.reject(new Error("no body")),
    });
    // %2F stays encoded in pathname, `..` caught by includes check
    expect(res.status).toBe(403);
  });

  it("does not serve assets without staticDir option", async () => {
    const handler = createHttpHandler(router);
    const res = await req(handler, "GET", "/_seam/static/main-abc.js");
    expect(res.status).toBe(404);
  });

  it("falls back to octet-stream for unknown extensions", async () => {
    const handler = makeHandler();
    const res = await req(handler, "GET", "/_seam/static/data.bin");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/octet-stream");
    expect(res.body).toBe("binary content");
  });

  it("serves woff2 with correct MIME type", async () => {
    const handler = makeHandler();
    const res = await req(handler, "GET", "/_seam/static/font.woff2");
    expect(res.status).toBe(200);
    expect(res.headers["Content-Type"]).toBe("font/woff2");
  });
});
