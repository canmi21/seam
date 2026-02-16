/* tests/e2e/fixture/src/server/index.ts */

import { resolve } from "node:path";
import { loadBuildOutput } from "@canmi/seam-server";
import { serveBun } from "@canmi/seam-adapter-bun";
import { buildRouter } from "./router.js";

// When compiled to .seam/output/server/index.js, parent dir is the build root
const BUILD_DIR = resolve(import.meta.dir, "..");
const pages = loadBuildOutput(BUILD_DIR);
const router = buildRouter({ pages });

// Page-serving fallback: handles GET requests to routes with templates
const pageFallback = async (req: { method: string; url: string }) => {
  if (req.method !== "GET") return { status: 404 as const, headers: {}, body: "Not found" };
  const pathname = new URL(req.url).pathname;
  const result = await router.handlePage(pathname);
  if (result)
    return { status: result.status, headers: { "content-type": "text/html" }, body: result.html };
  return { status: 404 as const, headers: {}, body: "Not found" };
};

const port = Number(process.env.PORT) || 3000;
const server = serveBun(router, {
  port,
  staticDir: resolve(BUILD_DIR, "public"),
  fallback: pageFallback,
});

console.log(`E2E fixture running on http://localhost:${server.port}`);
