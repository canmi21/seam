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

// Root-path page serving with response timing
app.get("*", async (c) => {
  const start = performance.now();
  const result = await router.handlePage(new URL(c.req.url).pathname);
  if (!result) return c.text("Not Found", 404);
  const ms = (performance.now() - start).toFixed(2);
  const html = result.html.replace("__RENDER_TIME__", ms);
  return c.html(html, result.status as 200);
});

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
};

console.log(`GitHub Dashboard running on http://localhost:${port}`);
