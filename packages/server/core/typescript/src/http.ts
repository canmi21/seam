/* packages/server/core/typescript/src/http.ts */

import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { Router, DefinitionMap } from "./router/index.js";
import { SeamError } from "./errors.js";
import { MIME_TYPES } from "./mime.js";

export interface HttpRequest {
  method: string;
  url: string;
  body: () => Promise<unknown>;
}

export interface HttpBodyResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface HttpStreamResponse {
  status: number;
  headers: Record<string, string>;
  stream: AsyncIterable<string>;
}

export type HttpResponse = HttpBodyResponse | HttpStreamResponse;

export type HttpHandler = (req: HttpRequest) => Promise<HttpResponse>;

export interface HttpHandlerOptions {
  staticDir?: string;
  fallback?: HttpHandler;
}

const RPC_PREFIX = "/_seam/rpc/";
const PAGE_PREFIX = "/_seam/page/";
const STATIC_PREFIX = "/_seam/static/";
const SUBSCRIBE_PREFIX = "/_seam/subscribe/";
const MANIFEST_PATH = "/_seam/manifest.json";

const JSON_HEADER = { "Content-Type": "application/json" };
const HTML_HEADER = { "Content-Type": "text/html; charset=utf-8" };
const SSE_HEADER = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

function jsonResponse(status: number, body: unknown): HttpBodyResponse {
  return { status, headers: JSON_HEADER, body };
}

function errorResponse(status: number, code: string, message: string): HttpBodyResponse {
  return jsonResponse(status, new SeamError(code, message).toJSON());
}

async function handleStaticAsset(assetPath: string, staticDir: string): Promise<HttpBodyResponse> {
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

/** Format a single SSE data event */
export function sseDataEvent(data: unknown): string {
  return `event: data\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Format an SSE error event */
export function sseErrorEvent(code: string, message: string): string {
  return `event: error\ndata: ${JSON.stringify({ code, message })}\n\n`;
}

/** Format an SSE complete event */
export function sseCompleteEvent(): string {
  return "event: complete\ndata: {}\n\n";
}

async function* sseStream<T extends DefinitionMap>(
  router: Router<T>,
  name: string,
  input: unknown,
): AsyncIterable<string> {
  try {
    for await (const value of router.handleSubscription(name, input)) {
      yield sseDataEvent(value);
    }
    yield sseCompleteEvent();
  } catch (error) {
    if (error instanceof SeamError) {
      yield sseErrorEvent(error.code, error.message);
    } else {
      const message = error instanceof Error ? error.message : "Unknown error";
      yield sseErrorEvent("INTERNAL_ERROR", message);
    }
  }
}

export function createHttpHandler<T extends DefinitionMap>(
  router: Router<T>,
  opts?: HttpHandlerOptions,
): HttpHandler {
  return async (req) => {
    const url = new URL(req.url, "http://localhost");
    const { pathname } = url;

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

    if (req.method === "GET" && pathname.startsWith(SUBSCRIBE_PREFIX)) {
      const name = pathname.slice(SUBSCRIBE_PREFIX.length);
      if (!name) {
        return errorResponse(404, "NOT_FOUND", "Empty subscription name");
      }

      const rawInput = url.searchParams.get("input");
      let input: unknown;
      try {
        input = rawInput ? JSON.parse(rawInput) : {};
      } catch {
        return errorResponse(400, "VALIDATION_ERROR", "Invalid input query parameter");
      }

      return { status: 200, headers: SSE_HEADER, stream: sseStream(router, name, input) };
    }

    if (req.method === "GET" && pathname.startsWith(PAGE_PREFIX) && router.hasPages) {
      const pagePath = "/" + pathname.slice(PAGE_PREFIX.length);
      const result = await router.handlePage(pagePath);
      if (result) {
        return { status: result.status, headers: HTML_HEADER, body: result.html };
      }
    }

    if (req.method === "GET" && pathname.startsWith(STATIC_PREFIX) && opts?.staticDir) {
      const assetPath = pathname.slice(STATIC_PREFIX.length);
      return handleStaticAsset(assetPath, opts.staticDir);
    }

    if (opts?.fallback) return opts.fallback(req);
    return errorResponse(404, "NOT_FOUND", "Not found");
  };
}

export function serialize(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

/** Convert an HttpResponse to a Web API Response (for adapters using fetch-compatible runtimes) */
export function toWebResponse(result: HttpResponse): Response {
  if ("stream" in result) {
    const stream = result.stream;
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            controller.enqueue(new TextEncoder().encode(chunk));
          }
        } catch {
          // Client disconnected
        } finally {
          controller.close();
        }
      },
    });
    return new Response(readable, { status: result.status, headers: result.headers });
  }
  return new Response(serialize(result.body), { status: result.status, headers: result.headers });
}
