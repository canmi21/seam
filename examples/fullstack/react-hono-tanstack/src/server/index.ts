/* examples/fullstack/react-hono-tanstack/src/server/index.ts */

import { Hono } from "hono";
import { createRouter } from "@canmi/seam-server";
import { seam } from "@canmi/seam-adapter-hono";
import { getMessages, addMessage } from "./procedures.js";
import { onMessage } from "./subscriptions.js";

const router = createRouter({ getMessages, addMessage, onMessage });

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
