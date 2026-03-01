/* src/server/adapter/bun/src/index.ts */

import { createHttpHandler, toWebResponse, startChannelWs } from "@canmi/seam-server";
import type {
  DefinitionMap,
  Router,
  HttpHandler,
  RpcHashMap,
  ChannelWsSession,
  ChannelWsOptions,
} from "@canmi/seam-server";

export interface ServeBunOptions {
  port?: number;
  staticDir?: string;
  fallback?: HttpHandler;
  rpcHashMap?: RpcHashMap;
  wsOptions?: ChannelWsOptions;
}

const PROCEDURE_PREFIX = "/_seam/procedure/";
const EVENTS_SUFFIX = ".events";

interface WsData {
  channelName: string;
  channelInput: unknown;
  session?: ChannelWsSession;
}

export function serveBun<T extends DefinitionMap>(router: Router<T>, opts?: ServeBunOptions) {
  const handler = createHttpHandler(router, {
    staticDir: opts?.staticDir,
    fallback: opts?.fallback,
    rpcHashMap: opts?.rpcHashMap,
  });

  return Bun.serve<WsData>({
    port: opts?.port ?? 3000,

    async fetch(req, server) {
      // WebSocket upgrade for channel paths
      if (req.method === "GET" && req.headers.get("upgrade") === "websocket") {
        const url = new URL(req.url);
        const { pathname } = url;
        if (pathname.startsWith(PROCEDURE_PREFIX) && pathname.endsWith(EVENTS_SUFFIX)) {
          const channelName = pathname.slice(PROCEDURE_PREFIX.length, -EVENTS_SUFFIX.length);
          const rawInput = url.searchParams.get("input");
          let channelInput: unknown;
          try {
            channelInput = rawInput ? JSON.parse(rawInput) : {};
          } catch {
            return new Response("Invalid input query parameter", { status: 400 });
          }
          const upgraded = server.upgrade(req, {
            data: { channelName, channelInput },
          });
          if (upgraded) return undefined;
          return new Response("WebSocket upgrade failed", { status: 500 });
        }
      }

      const result = await handler({
        method: req.method,
        url: req.url,
        body: () => req.json(),
        header: (name) => req.headers.get(name),
      });
      return toWebResponse(result);
    },

    websocket: {
      open(ws) {
        const { channelName, channelInput } = ws.data;
        ws.data.session = startChannelWs(
          router,
          channelName,
          channelInput,
          {
            send: (data) => ws.send(data),
          },
          opts?.wsOptions,
        );
      },
      message(ws, message) {
        const text = typeof message === "string" ? message : new TextDecoder().decode(message);
        ws.data.session?.onMessage(text);
      },
      close(ws) {
        ws.data.session?.close();
      },
    },
  });
}
