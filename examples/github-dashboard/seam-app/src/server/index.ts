/* examples/github-dashboard/seam-app/src/server/index.ts */

import { resolve } from "node:path";
import { Hono } from "hono";
import { loadBuildOutput } from "@canmi/seam-server";
import { seam } from "@canmi/seam-adapter-hono";
import { buildRouter } from "./router.js";

// When compiled to .seam/output/server/index.js, parent dir is the build root
const BUILD_DIR = resolve(import.meta.dir, "..");
const pages = loadBuildOutput(BUILD_DIR);
const router = buildRouter({ pages });

const app = new Hono();

// Seam middleware: handles /_seam/* (RPC, manifest, static, pages)
app.use("/*", seam(router, { staticDir: resolve(BUILD_DIR, "public") }));

// Root-path page serving — inject performance overlay outside React tree
app.get("*", async (c) => {
  const result = await router.handlePage(new URL(c.req.url).pathname);
  if (!result) return c.text("Not Found", 404);

  const { dataFetch, inject } = result.timing;
  const overlay = [
    `<div style="position:fixed;bottom:0;left:0;right:0;padding:6px 16px;`,
    `background:rgba(0,0,0,.75);color:#ede9e0;font:12px/1.6 monospace;`,
    `display:flex;gap:24px;z-index:9999">`,
    `<span>Data Fetch: <b>${dataFetch.toFixed(2)}ms</b></span>`,
    `<span>Inject: <b>${inject < 1 ? `${(inject * 1000).toFixed(0)}\u00b5s` : `${inject.toFixed(2)}ms`}</b></span>`,
    `</div>`,
  ].join("");

  const html = result.html.replace("</body>", overlay + "</body>");
  return c.html(html, result.status as 200);
});

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};

console.log(`GitHub Dashboard running on http://localhost:${port}`);
