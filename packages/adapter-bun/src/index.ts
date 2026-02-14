import type { ProcedureMap, Router } from "@canmi/seam-server";

export interface ServeBunOptions {
  port?: number;
}

const RPC_PREFIX = "/seam/rpc/";
const MANIFEST_PATH = "/seam/manifest.json";

export function serveBun<T extends ProcedureMap>(router: Router<T>, opts?: ServeBunOptions) {
  return Bun.serve({
    port: opts?.port ?? 3000,
    async fetch(req) {
      const url = new URL(req.url);
      const { pathname } = url;

      if (req.method === "GET" && pathname === MANIFEST_PATH) {
        return Response.json(router.manifest());
      }

      if (req.method === "POST" && pathname.startsWith(RPC_PREFIX)) {
        const name = pathname.slice(RPC_PREFIX.length);
        if (!name) {
          return Response.json(
            { error: { code: "NOT_FOUND", message: "Empty procedure name" } },
            { status: 404 },
          );
        }

        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json(
            { error: { code: "VALIDATION_ERROR", message: "Invalid JSON body" } },
            { status: 400 },
          );
        }

        const result = await router.handle(name, body);
        return Response.json(result.body, { status: result.status });
      }

      return Response.json({ error: { code: "NOT_FOUND", message: "Not found" } }, { status: 404 });
    },
  });
}
