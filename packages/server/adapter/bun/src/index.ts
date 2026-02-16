/* packages/server/adapter/bun/src/index.ts */

import { createHttpHandler, toWebResponse } from "@canmi/seam-server";
import type { DefinitionMap, Router, HttpHandler } from "@canmi/seam-server";

export interface ServeBunOptions {
  port?: number;
  staticDir?: string;
  fallback?: HttpHandler;
}

export function serveBun<T extends DefinitionMap>(router: Router<T>, opts?: ServeBunOptions) {
  const handler = createHttpHandler(router, {
    staticDir: opts?.staticDir,
    fallback: opts?.fallback,
  });
  return Bun.serve({
    port: opts?.port ?? 3000,
    async fetch(req) {
      const result = await handler({ method: req.method, url: req.url, body: () => req.json() });
      return toWebResponse(result);
    },
  });
}
