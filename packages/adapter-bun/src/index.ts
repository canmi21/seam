import { createHttpHandler } from "@canmi/seam-server";
import type { ProcedureMap, Router } from "@canmi/seam-server";

export interface ServeBunOptions {
  port?: number;
}

function serialize(body: unknown): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

export function serveBun<T extends ProcedureMap>(router: Router<T>, opts?: ServeBunOptions) {
  const handler = createHttpHandler(router);
  return Bun.serve({
    port: opts?.port ?? 3000,
    async fetch(req) {
      const result = await handler({ method: req.method, url: req.url, body: () => req.json() });
      return new Response(serialize(result.body), { status: result.status, headers: result.headers });
    },
  });
}
