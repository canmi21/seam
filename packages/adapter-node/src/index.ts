import { createServer } from "node:http";
import { createHttpHandler } from "@canmi/seam-server";
import type { ProcedureMap, Router } from "@canmi/seam-server";

export interface ServeNodeOptions {
  port?: number;
}

export function serveNode<T extends ProcedureMap>(router: Router<T>, opts?: ServeNodeOptions) {
  const handler = createHttpHandler(router);
  const server = createServer(async (req, res) => {
    const bodyPromise = new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });

    const result = await handler({
      method: req.method || "GET",
      url: `http://localhost${req.url || "/"}`,
      body: async () => JSON.parse(await bodyPromise),
    });

    const body = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
    res.writeHead(result.status, result.headers);
    res.end(body);
  });

  server.listen(opts?.port ?? 3000);
  return server;
}
