/* packages/server/adapter/hono/src/index.ts */

import { createHttpHandler, toWebResponse } from "@canmi/seam-server";
import type {
  DefinitionMap,
  Router,
  HttpHandler,
  HttpHandlerOptions,
  RpcHashMap,
} from "@canmi/seam-server";
import type { MiddlewareHandler } from "hono";

export interface SeamHonoOptions {
  staticDir?: string;
  fallback?: HttpHandler;
  rpcHashMap?: RpcHashMap;
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
  if (opts?.rpcHashMap) handlerOpts.rpcHashMap = opts.rpcHashMap;

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
      header: (name) => raw.headers.get(name),
    });

    return toWebResponse(result);
  };
}
