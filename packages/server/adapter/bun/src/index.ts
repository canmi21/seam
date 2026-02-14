/* packages/server/adapter/bun/src/index.ts */

import { createHttpHandler } from "@canmi/seam-server";
import type { DefinitionMap, Router, HttpResponse } from "@canmi/seam-server";

export interface ServeBunOptions {
  port?: number;
  staticDir?: string;
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

export function serveBun<T extends DefinitionMap>(router: Router<T>, opts?: ServeBunOptions) {
  const handler = createHttpHandler(router, { staticDir: opts?.staticDir });
  return Bun.serve({
    port: opts?.port ?? 3000,
    async fetch(req) {
      const result = await handler({ method: req.method, url: req.url, body: () => req.json() });
      return toResponse(result);
    },
  });
}
