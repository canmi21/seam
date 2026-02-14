/* packages/server/core/typescript/src/http.ts */

import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { Router, ProcedureMap } from "./router/index.js";
import { SeamError, type ErrorCode } from "./errors.js";

export interface HttpRequest {
  method: string;
  url: string;
  body: () => Promise<unknown>;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type HttpHandler = (req: HttpRequest) => Promise<HttpResponse>;

export interface HttpHandlerOptions {
  staticDir?: string;
}

const RPC_PREFIX = "/seam/rpc/";
const PAGE_PREFIX = "/seam/page/";
const ASSETS_PREFIX = "/seam/assets/";
const MANIFEST_PATH = "/seam/manifest.json";

const JSON_HEADER = { "Content-Type": "application/json" };
const HTML_HEADER = { "Content-Type": "text/html; charset=utf-8" };
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

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
};

function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, headers: JSON_HEADER, body };
}

function errorResponse(status: number, code: ErrorCode, message: string): HttpResponse {
  return jsonResponse(status, new SeamError(code, message).toJSON());
}

async function handleStaticAsset(assetPath: string, staticDir: string): Promise<HttpResponse> {
  if (assetPath.includes("..")) {
    return errorResponse(403, "VALIDATION_ERROR", "Forbidden");
  }

  const filePath = join(staticDir, assetPath);
  try {
    const content = await readFile(filePath, "utf-8");
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    return {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": IMMUTABLE_CACHE,
      },
      body: content,
    };
  } catch {
    return errorResponse(404, "NOT_FOUND", "Asset not found");
  }
}

export function createHttpHandler<T extends ProcedureMap>(
  router: Router<T>,
  opts?: HttpHandlerOptions,
): HttpHandler {
  return async (req) => {
    const { pathname } = new URL(req.url, "http://localhost");

    if (req.method === "GET" && pathname === MANIFEST_PATH) {
      return jsonResponse(200, router.manifest());
    }

    if (req.method === "POST" && pathname.startsWith(RPC_PREFIX)) {
      const name = pathname.slice(RPC_PREFIX.length);
      if (!name) {
        return errorResponse(404, "NOT_FOUND", "Empty procedure name");
      }

      let body: unknown;
      try {
        body = await req.body();
      } catch {
        return errorResponse(400, "VALIDATION_ERROR", "Invalid JSON body");
      }

      const result = await router.handle(name, body);
      return jsonResponse(result.status, result.body);
    }

    if (req.method === "GET" && pathname.startsWith(PAGE_PREFIX) && router.hasPages) {
      const pagePath = "/" + pathname.slice(PAGE_PREFIX.length);
      const result = await router.handlePage(pagePath);
      if (result) {
        return { status: result.status, headers: HTML_HEADER, body: result.html };
      }
    }

    if (req.method === "GET" && pathname.startsWith(ASSETS_PREFIX) && opts?.staticDir) {
      const assetPath = pathname.slice(ASSETS_PREFIX.length);
      return handleStaticAsset(assetPath, opts.staticDir);
    }

    return errorResponse(404, "NOT_FOUND", "Not found");
  };
}
