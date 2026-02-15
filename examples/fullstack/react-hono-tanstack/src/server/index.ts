/* examples/fullstack/react-hono-tanstack/src/server/index.ts */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import { loadBuildOutput } from "@canmi/seam-server";
import { seam } from "@canmi/seam-adapter-hono";
import { buildRouter } from "./router.js";

// When compiled to .seam/output/server/index.js, parent dir is the build root
const BUILD_DIR = resolve(import.meta.dir, "..");
const isProd = existsSync(resolve(BUILD_DIR, "route-manifest.json"));

const pages = isProd ? loadBuildOutput(BUILD_DIR) : undefined;
const router = buildRouter(pages ? { pages } : undefined);

const app = new Hono();

// Seam handles /_seam/* (RPC, SSE, manifest, static assets)
app.use("/*", seam(router, isProd ? { staticDir: resolve(BUILD_DIR, "public") } : undefined));

// SSR page serving: match routes and return injected HTML
if (isProd) {
  app.get("*", async (c) => {
    const result = await router.handlePage(c.req.path);
    if (result) {
      return c.html(result.html, result.status);
    }
    return c.text("Not Found", 404);
  });
}

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255, // max value; keep SSE connections alive
};

console.log(
  `Seam backend running on http://localhost:${port} (${isProd ? "production" : "development"})`,
);
