import { createHttpHandler } from "@canmi/seam-server";
import type { ProcedureMap, Router } from "@canmi/seam-server";

export interface ServeBunOptions {
  port?: number;
}

export function serveBun<T extends ProcedureMap>(router: Router<T>, opts?: ServeBunOptions) {
  const handler = createHttpHandler(router);
  return Bun.serve({
    port: opts?.port ?? 3000,
    async fetch(req) {
      const result = await handler({ method: req.method, url: req.url, body: () => req.json() });
      const body = typeof result.body === "string" ? result.body : JSON.stringify(result.body);
      return new Response(body, { status: result.status, headers: result.headers });
    },
  });
}
