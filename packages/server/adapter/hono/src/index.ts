/* packages/server/adapter/hono/src/index.ts */

import { createHttpHandler, toWebResponse, startChannelWs } from "@canmi/seam-server";
import type {
  DefinitionMap,
  Router,
  HttpHandler,
  HttpHandlerOptions,
  RpcHashMap,
  ChannelWsOptions,
  ChannelWsSession,
} from "@canmi/seam-server";
import type { MiddlewareHandler } from "hono";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Hono-compatible upgradeWebSocket factory.
 * Runtimes (Deno, Bun, Cloudflare) provide their own implementation;
 * the user injects it via options so the adapter stays runtime-agnostic.
 */
export type UpgradeWebSocket = (
  handler: (c: any) => {
    onOpen?: (evt: any, ws: any) => void;
    onMessage?: (evt: any, ws: any) => void;
    onClose?: (evt: any, ws: any) => void;
  },
) => MiddlewareHandler;

/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SeamHonoOptions {
  staticDir?: string;
  fallback?: HttpHandler;
  rpcHashMap?: RpcHashMap;
  upgradeWebSocket?: UpgradeWebSocket;
  wsOptions?: ChannelWsOptions;
}

const SEAM_PREFIX = "/_seam/";
const PROCEDURE_PREFIX = "/_seam/procedure/";
const EVENTS_SUFFIX = ".events";

// Track WS sessions without patching the ws object
const wsSessions = new WeakMap<object, ChannelWsSession>();

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

    // WebSocket upgrade for channel paths
    if (
      opts?.upgradeWebSocket &&
      c.req.header("upgrade") === "websocket" &&
      url.pathname.startsWith(PROCEDURE_PREFIX) &&
      url.pathname.endsWith(EVENTS_SUFFIX)
    ) {
      const channelName = url.pathname.slice(PROCEDURE_PREFIX.length, -EVENTS_SUFFIX.length);
      const rawInput = url.searchParams.get("input");
      let channelInput: unknown;
      try {
        channelInput = rawInput ? JSON.parse(rawInput) : {};
      } catch {
        return c.text("Invalid input query parameter", 400);
      }

      const wsHandler = opts.upgradeWebSocket(() => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onOpen(_evt: any, ws: any) {
          const wsObj = ws as object;
          const session = startChannelWs(
            router,
            channelName,
            channelInput,
            { send: (data: string) => (ws as { send: (d: string) => void }).send(data) },
            opts.wsOptions,
          );
          wsSessions.set(wsObj, session);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onMessage(evt: any, ws: any) {
          const session = wsSessions.get(ws as object);
          const text =
            typeof (evt as { data: unknown }).data === "string"
              ? (evt as { data: string }).data
              : String((evt as { data: unknown }).data);
          session?.onMessage(text);
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClose(_evt: any, ws: any) {
          const session = wsSessions.get(ws as object);
          session?.close();
          wsSessions.delete(ws as object);
        },
      }));
      return wsHandler(c, next);
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
