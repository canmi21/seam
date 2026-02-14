/* packages/server/adapter/node/src/index.ts */

import type { IncomingMessage } from "node:http";
import { createServer } from "node:http";
import { createHttpHandler } from "@canmi/seam-server";
import type { ProcedureMap, Router } from "@canmi/seam-server";

export interface ServeNodeOptions {
  port?: number;
  staticDir?: string;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function serialize(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

export function serveNode<T extends ProcedureMap>(router: Router<T>, opts?: ServeNodeOptions) {
  const handler = createHttpHandler(router, { staticDir: opts?.staticDir });
  const server = createServer(async (req, res) => {
    const raw = readBody(req);
    const result = await handler({
      method: req.method || "GET",
      url: `http://localhost${req.url || "/"}`,
      body: async () => JSON.parse(await raw),
    });

    res.writeHead(result.status, result.headers);
    res.end(serialize(result.body));
  });

  server.listen(opts?.port ?? 3000);
  return server;
}
