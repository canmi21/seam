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

  const { dataFetch, inject: injectTime } = result.timing;
  const fmt = (ms: number) => (ms < 1 ? `${(ms * 1000).toFixed(0)}\u00b5s` : `${ms.toFixed(2)}ms`);
  const timing = `\u00a0\u00b7 Data Fetch ${fmt(dataFetch)} \u00b7 Inject ${fmt(injectTime)}`;

  // Append timing after __SEAM_ROOT__ (scripts are invisible, so it renders right below the footer)
  let html = result.html.replace("<body>", '<body style="background-color:var(--c-surface)">');
  html = html.replace(
    "</body>",
    `<div style="max-width:48rem;margin:0 auto;padding:0 1rem 2rem;text-align:center;font-size:.875rem;color:var(--c-text-muted)">${timing}</div></body>`,
  );
  return c.html(html, result.status as 200);
});

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};

console.log(`GitHub Dashboard running on http://localhost:${port}`);
