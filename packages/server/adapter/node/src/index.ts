/* packages/server/adapter/node/src/index.ts */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, request as httpRequest } from "node:http";
import { createHttpHandler, serialize, drainStream, startChannelWs } from "@canmi/seam-server";
import type {
  DefinitionMap,
  Router,
  HttpHandler,
  HttpResponse,
  RpcHashMap,
  ChannelWsOptions,
} from "@canmi/seam-server";
import { WebSocketServer } from "ws";

export interface ServeNodeOptions {
  port?: number;
  staticDir?: string;
  fallback?: HttpHandler;
  rpcHashMap?: RpcHashMap;
  /** WebSocket proxy target for HMR (e.g. "ws://localhost:5173") */
  wsProxy?: string;
  wsOptions?: ChannelWsOptions;
}

const PROCEDURE_PREFIX = "/_seam/procedure/";
const EVENTS_SUFFIX = ".events";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

async function sendResponse(res: ServerResponse, result: HttpResponse): Promise<void> {
  res.writeHead(result.status, result.headers);
  if ("stream" in result) {
    await drainStream(result.stream, (chunk) => {
      if (!res.writable) return false;
      res.write(chunk);
    });
    res.end();
    return;
  }
  res.end(serialize(result.body));
}

export function serveNode<T extends DefinitionMap>(router: Router<T>, opts?: ServeNodeOptions) {
  const handler = createHttpHandler(router, {
    staticDir: opts?.staticDir,
    fallback: opts?.fallback,
    rpcHashMap: opts?.rpcHashMap,
  });
  const server = createServer((req, res) => {
    const raw = readBody(req);
    void (async () => {
      const result = await handler({
        method: req.method || "GET",
        url: `http://localhost${req.url || "/"}`,
        body: async () => JSON.parse(await raw) as unknown,
        header: (name) => {
          const v = req.headers[name.toLowerCase()];
          return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;
        },
      });
      await sendResponse(res, result);
    })();
  });

  // Single WebSocketServer instance for channel connections (noServer mode)
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "/", "http://localhost");
    const { pathname } = url;

    // Handle channel WebSocket upgrade
    if (pathname.startsWith(PROCEDURE_PREFIX) && pathname.endsWith(EVENTS_SUFFIX)) {
      const channelName = pathname.slice(PROCEDURE_PREFIX.length, -EVENTS_SUFFIX.length);
      const rawInput = url.searchParams.get("input");
      let channelInput: unknown;
      try {
        channelInput = rawInput ? JSON.parse(rawInput) : {};
      } catch {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const session = startChannelWs(
          router,
          channelName,
          channelInput,
          {
            send: (data) => ws.send(data),
          },
          opts?.wsOptions,
        );

        ws.on("message", (raw) => {
          const text =
            typeof raw === "string"
              ? raw
              : Buffer.isBuffer(raw)
                ? raw.toString("utf-8")
                : Buffer.from(raw as ArrayBuffer).toString("utf-8");
          session.onMessage(text);
        });
        ws.on("close", () => session.close());
      });
      return;
    }

    // Forward non-seam WS upgrade to dev server proxy
    if (opts?.wsProxy) {
      if (req.url?.startsWith("/_seam/")) return;

      const wsTarget = new URL(opts.wsProxy);
      const proxyReq = httpRequest({
        hostname: wsTarget.hostname,
        port: wsTarget.port,
        path: req.url,
        method: req.method,
        headers: req.headers,
      });
      proxyReq.on("upgrade", (_res, proxySocket, proxyHead) => {
        socket.write(
          `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`,
        );
        if (proxyHead.length > 0) socket.write(proxyHead);
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
      });
      proxyReq.on("error", () => socket.destroy());
      proxyReq.end(head);
    }
  });

  server.listen(opts?.port ?? 3000);
  return server;
}
