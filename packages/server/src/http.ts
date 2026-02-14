import type { Router, ProcedureMap } from "./router/index.js";
import { SeamError } from "./errors.js";

export interface HttpRequest {
  method: string;
  url: string;
  body: () => Promise<unknown>;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export type HttpHandler = (req: HttpRequest) => Promise<HttpResponse>;

const RPC_PREFIX = "/seam/rpc/";
const PAGE_PREFIX = "/seam/page/";
const MANIFEST_PATH = "/seam/manifest.json";

const JSON_HEADER = { "Content-Type": "application/json" };
const HTML_HEADER = { "Content-Type": "text/html; charset=utf-8" };

function jsonResponse(status: number, body: unknown): HttpResponse {
  return { status, headers: JSON_HEADER, body };
}

export function createHttpHandler<T extends ProcedureMap>(router: Router<T>): HttpHandler {
  return async (req) => {
    const { pathname } = new URL(req.url, "http://localhost");

    if (req.method === "GET" && pathname === MANIFEST_PATH) {
      return jsonResponse(200, router.manifest());
    }

    if (req.method === "POST" && pathname.startsWith(RPC_PREFIX)) {
      const name = pathname.slice(RPC_PREFIX.length);
      if (!name) {
        return jsonResponse(404, new SeamError("NOT_FOUND", "Empty procedure name").toJSON());
      }

      let body: unknown;
      try {
        body = await req.body();
      } catch {
        return jsonResponse(400, new SeamError("VALIDATION_ERROR", "Invalid JSON body").toJSON());
      }

      const result = await router.handle(name, body);
      return jsonResponse(result.status, result.body);
    }

    if (req.method === "GET" && pathname.startsWith(PAGE_PREFIX) && router.hasPages) {
      const pagePath = "/" + pathname.slice(PAGE_PREFIX.length);
      const result = await router.handlePage(pagePath);
      if (result) {
        return { status: result.status, headers: HTML_HEADER, body: result.html };
      }
    }

    return jsonResponse(404, new SeamError("NOT_FOUND", "Not found").toJSON());
  };
}
