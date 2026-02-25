/* examples/github-dashboard/backends/ts-hono/src/index.ts */

import { resolve } from "node:path";
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import {
  loadBuildOutput,
  loadBuildOutputDev,
  loadRpcHashMap,
  watchReloadTrigger,
} from "@canmi/seam-server";
import { seam } from "@canmi/seam-adapter-hono";
import { buildRouter } from "./router.js";

import type { ServerWebSocket } from "bun";

const isDev = process.env.SEAM_DEV === "1";
const isVite = process.env.SEAM_VITE === "1";
const BUILD_DIR =
  process.env.SEAM_OUTPUT_DIR ?? (isDev ? ".seam/output" : resolve(import.meta.dir, ".."));

// Gracefully handle missing build output (API-only mode without page serving)
let pages: Record<string, unknown> = {};
try {
  pages = isDev ? loadBuildOutputDev(BUILD_DIR) : loadBuildOutput(BUILD_DIR);
} catch {
  // No build output available — RPC still works, page serving disabled
}
const rpcHashMap = loadRpcHashMap(BUILD_DIR);
const dataId = Object.values(pages)[0]?.dataId ?? "__data";
const router = buildRouter({ pages });

const app = new Hono();

// Dev-mode WebSocket for live reload (skipped when Vite handles HMR)
const { upgradeWebSocket, websocket } = createBunWebSocket();
const devClients = new Set<ServerWebSocket>();

if (isDev && !isVite) {
  app.get(
    "/_seam/dev/ws",
    upgradeWebSocket(() => ({
      onOpen(_ev, ws) {
        devClients.add(ws.raw as ServerWebSocket);
      },
      onClose(_ev, ws) {
        devClients.delete(ws.raw as ServerWebSocket);
      },
    })),
  );

  watchReloadTrigger(BUILD_DIR, () => {
    for (const c of devClients) {
      try {
        c.send("reload");
      } catch {
        devClients.delete(c);
      }
    }
  });
}

// Seam middleware: handles /_seam/* (RPC, manifest, static, pages)
app.use("/*", seam(router, { staticDir: resolve(BUILD_DIR, "public"), rpcHashMap }));

// Root-path page serving -- inject timing into data script's _meta
app.get("*", async (c) => {
  const result = await router.handlePage(new URL(c.req.url).pathname);
  if (!result) return c.text("Not Found", 404);

  const { dataFetch, inject: injectTime } = result.timing;
  const fmt = (ms: number) => (ms < 1 ? `${(ms * 1000).toFixed(0)}\u00b5s` : `${ms.toFixed(2)}ms`);
  const timing = `\u00a0\u00b7 Data Fetch ${fmt(dataFetch)} \u00b7 Inject ${fmt(injectTime)}`;

  let html = result.html.replace("<body>", '<body style="background-color:var(--c-surface)">');

  // Append _meta.timing into the data script JSON
  const dataIdPattern = new RegExp(`<script id="${dataId}" type="application/json">(.*?)</script>`);
  html = html.replace(dataIdPattern, (_match, json) => {
    const data = JSON.parse(json);
    data._meta = { timing };
    return `<script id="${dataId}" type="application/json">${JSON.stringify(data)}</script>`;
  });
  return c.html(html, result.status as 200);
});

const port = process.env.PORT !== undefined ? Number(process.env.PORT) : 3000;

const server = Bun.serve({
  port,
  fetch: app.fetch,
  ...(isDev ? { websocket } : {}),
});

console.log(`GitHub Dashboard (ts-hono) running on http://localhost:${server.port}`);
