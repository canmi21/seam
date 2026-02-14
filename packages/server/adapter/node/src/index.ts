/* packages/server/adapter/node/src/index.ts */

import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:http";
import { createHttpHandler } from "@canmi/seam-server";
import type { DefinitionMap, Router, HttpResponse } from "@canmi/seam-server";

export interface ServeNodeOptions {
  port?: number;
  staticDir?: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function serialize(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

async function sendResponse(res: ServerResponse, result: HttpResponse): Promise<void> {
  if ("stream" in result) {
    res.writeHead(result.status, result.headers);
    try {
      for await (const chunk of result.stream) {
        if (!res.writable) break;
        res.write(chunk);
      }
    } catch {
      // Client disconnected
    }
    res.end();
    return;
  }

  res.writeHead(result.status, result.headers);
  res.end(serialize(result.body));
}

export function serveNode<T extends DefinitionMap>(router: Router<T>, opts?: ServeNodeOptions) {
  const handler = createHttpHandler(router, { staticDir: opts?.staticDir });
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

  server.listen(opts?.port ?? 3000);
  return server;
}
