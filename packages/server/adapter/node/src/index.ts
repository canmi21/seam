/* packages/server/adapter/node/src/index.ts */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, request as httpRequest } from "node:http";
import { createHttpHandler, serialize, drainStream } from "@canmi/seam-server";
import type { DefinitionMap, Router, HttpHandler, HttpResponse } from "@canmi/seam-server";

export interface ServeNodeOptions {
  port?: number;
  staticDir?: string;
  fallback?: HttpHandler;
  /** WebSocket proxy target for HMR (e.g. "ws://localhost:5173") */
  wsProxy?: string;
}

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
  });
  const server = createServer((req, res) => {
    const raw = readBody(req);
    void (async () => {
      const result = await handler({
        method: req.method || "GET",
        url: `http://localhost${req.url || "/"}`,
        body: async () => JSON.parse(await raw) as unknown,
      });
      await sendResponse(res, result);
    })();
  });

  if (opts?.wsProxy) {
    const wsTarget = new URL(opts.wsProxy);
    server.on("upgrade", (req, socket, head) => {
      // Keep seam-internal WS paths on this server
      if (req.url?.startsWith("/_seam/")) return;

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
    });
  }

  server.listen(opts?.port ?? 3000);
  return server;
}
