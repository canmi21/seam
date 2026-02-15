/* examples/fullstack/react-hono-tanstack/src/server/index.ts */

import { Hono } from "hono";
import { seam } from "@canmi/seam-adapter-hono";
import { router } from "./router.js";

const app = new Hono();

// Seam handles /_seam/* (RPC, SSE, manifest)
app.use("/*", seam(router));

const port = Number(process.env.PORT) || 3000;

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 255, // max value; keep SSE connections alive
};

console.log(`Seam backend running on http://localhost:${port}`);
