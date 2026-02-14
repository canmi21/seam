/* packages/client/vanilla/src/client.ts */

import { SeamClientError } from "./errors.js";
import type { ErrorCode } from "./errors.js";

export interface ClientOptions {
  baseUrl: string;
}

export type Unsubscribe = () => void;

export interface SeamClient {
  call(procedureName: string, input: unknown): Promise<unknown>;
  subscribe(
    name: string,
    input: unknown,
    onData: (data: unknown) => void,
    onError?: (err: SeamClientError) => void,
  ): Unsubscribe;
  fetchManifest(): Promise<unknown>;
}

const KNOWN_CODES = new Set<string>(["VALIDATION_ERROR", "NOT_FOUND", "INTERNAL_ERROR"]);

function isKnownCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && KNOWN_CODES.has(code);
}

interface ErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
  };
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = init ? await fetch(url, init) : await fetch(url);
  } catch {
    throw new SeamClientError("INTERNAL_ERROR", "Network request failed", 0);
  }

  if (!res.ok) {
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new SeamClientError("INTERNAL_ERROR", `HTTP ${res.status}`, res.status);
    }

    const err = (parsed as ErrorPayload)?.error;
    const code = isKnownCode(err?.code) ? err.code : "INTERNAL_ERROR";
    const message = typeof err?.message === "string" ? err.message : `HTTP ${res.status}`;
    throw new SeamClientError(code, message, res.status);
  }

  return res.json();
}

export function createClient(opts: ClientOptions): SeamClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");

  return {
    call(procedureName, input) {
      return request(`${baseUrl}/_seam/rpc/${procedureName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },

    subscribe(name, input, onData, onError) {
      const params = new URLSearchParams({ input: JSON.stringify(input) });
      const url = `${baseUrl}/_seam/subscribe/${name}?${params.toString()}`;
      const es = new EventSource(url);

      es.addEventListener("data", (e) => {
        try {
          onData(JSON.parse(e.data as string) as unknown);
        } catch {
          onError?.(new SeamClientError("INTERNAL_ERROR", "Failed to parse SSE data", 0));
        }
      });

      es.addEventListener("error", (e) => {
        if (e instanceof MessageEvent) {
          try {
            const payload = JSON.parse(e.data as string) as { code?: string; message?: string };
            const code = isKnownCode(payload.code) ? payload.code : "INTERNAL_ERROR";
            const message = typeof payload.message === "string" ? payload.message : "SSE error";
            onError?.(new SeamClientError(code, message, 0));
          } catch {
            onError?.(new SeamClientError("INTERNAL_ERROR", "SSE error", 0));
          }
        } else {
          onError?.(new SeamClientError("INTERNAL_ERROR", "SSE connection error", 0));
        }
        es.close();
      });

      es.addEventListener("complete", () => {
        es.close();
      });

      return () => {
        es.close();
      };
    },

    fetchManifest() {
      return request(`${baseUrl}/_seam/manifest.json`);
    },
  };
}
