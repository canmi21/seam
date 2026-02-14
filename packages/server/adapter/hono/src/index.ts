/* packages/server/adapter/hono/src/index.ts */

import { createHttpHandler } from "@canmi/seam-server";
import type {
  DefinitionMap,
  Router,
  HttpHandler,
  HttpHandlerOptions,
  HttpResponse,
} from "@canmi/seam-server";
import type { MiddlewareHandler } from "hono";

export interface SeamHonoOptions {
  staticDir?: string;
  fallback?: HttpHandler;
}

function serialize(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

function toResponse(result: HttpResponse): Response {
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
  return new Response(serialize(result.body), {
    status: result.status,
    headers: result.headers,
  });
}

const SEAM_PREFIX = "/_seam/";

/** Hono middleware that handles all /_seam/* routes via the seam router */
export function seam<T extends DefinitionMap>(
  router: Router<T>,
  opts?: SeamHonoOptions,
): MiddlewareHandler {
  const handlerOpts: HttpHandlerOptions = {};
  if (opts?.staticDir) handlerOpts.staticDir = opts.staticDir;
  if (opts?.fallback) handlerOpts.fallback = opts.fallback;

  const handler = createHttpHandler(router, handlerOpts);

  return async (c, next) => {
    const url = new URL(c.req.url);

    if (!url.pathname.startsWith(SEAM_PREFIX)) {
      return next();
    }

    const raw = c.req.raw;
    const result = await handler({
      method: raw.method,
      url: raw.url,
      body: () => raw.json(),
    });

    return toResponse(result);
  };
}
