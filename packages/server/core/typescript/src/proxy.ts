/* packages/server/core/typescript/src/proxy.ts */

import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { HttpHandler, HttpBodyResponse } from "./http.js";

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".ts": "application/javascript",
  ".tsx": "application/javascript",
};

export interface DevProxyOptions {
  /** Target URL to forward requests to (e.g. "http://localhost:5173") */
  target: string;
}

export interface StaticHandlerOptions {
  /** Directory to serve static files from */
  dir: string;
}

/** Forward non-seam requests to a dev server (e.g. Vite) */
export function createDevProxy(opts: DevProxyOptions): HttpHandler {
  const target = opts.target.replace(/\/$/, "");

  return async (req) => {
    const url = new URL(req.url, "http://localhost");
    const proxyUrl = `${target}${url.pathname}${url.search}`;

    try {
      const resp = await fetch(proxyUrl, {
        method: req.method,
        headers: { Accept: "*/*" },
      });

      const body = await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return { status: resp.status, headers, body };
    } catch {
      return {
        status: 502,
        headers: { "Content-Type": "text/plain" },
        body: `Bad Gateway: failed to connect to ${target}`,
      };
    }
  };
}

/** Serve static files from a directory, with index.html fallback for directories */
export function createStaticHandler(opts: StaticHandlerOptions): HttpHandler {
  const dir = opts.dir;

  return async (req): Promise<HttpBodyResponse> => {
    const url = new URL(req.url, "http://localhost");
    let filePath = url.pathname;

    if (filePath.includes("..")) {
      return {
        status: 403,
        headers: { "Content-Type": "text/plain" },
        body: "Forbidden",
      };
    }

    // Serve index.html for directory paths
    if (filePath.endsWith("/")) {
      filePath += "index.html";
    }

    const fullPath = join(dir, filePath);
    try {
      const content = await readFile(fullPath);
      const ext = extname(fullPath);
      const contentType = MIME_TYPES[ext] || "application/octet-stream";
      return {
        status: 200,
        headers: { "Content-Type": contentType },
        body: content.toString(),
      };
    } catch {
      return {
        status: 404,
        headers: { "Content-Type": "text/plain" },
        body: "Not found",
      };
    }
  };
}
