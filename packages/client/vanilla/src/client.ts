/* packages/client/vanilla/src/client.ts */

import { SeamClientError } from "./errors.js";

export interface ClientOptions {
  baseUrl: string;
  batchEndpoint?: string;
}

export type Unsubscribe = () => void;

export interface SeamClient {
  call(procedureName: string, input: unknown): Promise<unknown>;
  query(procedureName: string, input: unknown): Promise<unknown>;
  command(procedureName: string, input: unknown): Promise<unknown>;
  callBatch(calls: Array<{ procedure: string; input: unknown }>): Promise<{
    results: Array<
      | { ok: true; data: unknown }
      | { ok: false; error: { code: string; message: string; transient: boolean } }
    >;
  }>;
  subscribe(
    name: string,
    input: unknown,
    onData: (data: unknown) => void,
    onError?: (err: SeamClientError) => void,
  ): Unsubscribe;
  fetchManifest(): Promise<unknown>;
}

async function request(url: string, init?: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = init ? await fetch(url, init) : await fetch(url);
  } catch {
    throw new SeamClientError("INTERNAL_ERROR", "Network request failed", 0);
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new SeamClientError("INTERNAL_ERROR", `HTTP ${res.status}`, res.status);
  }

  const envelope = parsed as {
    ok?: boolean;
    data?: unknown;
    error?: { code?: string; message?: string; transient?: boolean };
  };

  if (envelope.ok === true) {
    return envelope.data;
  }

  const err = envelope.error;
  const code = typeof err?.code === "string" ? err.code : "INTERNAL_ERROR";
  const message = typeof err?.message === "string" ? err.message : `HTTP ${res.status}`;
  throw new SeamClientError(code, message, res.status);
}

export function createClient(opts: ClientOptions): SeamClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const batchPath = opts.batchEndpoint ?? "_batch";

  return {
    call(procedureName, input) {
      return request(`${baseUrl}/_seam/procedure/${procedureName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },

    query(procedureName, input) {
      return request(`${baseUrl}/_seam/procedure/${procedureName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },

    command(procedureName, input) {
      return request(`${baseUrl}/_seam/procedure/${procedureName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },

    callBatch(calls) {
      return request(`${baseUrl}/_seam/procedure/${batchPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ calls }),
      }) as Promise<{
        results: Array<
          | { ok: true; data: unknown }
          | { ok: false; error: { code: string; message: string; transient: boolean } }
        >;
      }>;
    },

    subscribe(name, input, onData, onError) {
      const params = new URLSearchParams({ input: JSON.stringify(input) });
      const url = `${baseUrl}/_seam/procedure/${name}?${params.toString()}`;
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
            const code = typeof payload.code === "string" ? payload.code : "INTERNAL_ERROR";
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

    async fetchManifest() {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/_seam/manifest.json`);
      } catch {
        throw new SeamClientError("INTERNAL_ERROR", "Network request failed", 0);
      }
      if (!res.ok) {
        throw new SeamClientError("INTERNAL_ERROR", `HTTP ${res.status}`, res.status);
      }
      return (await res.json()) as unknown;
    },
  };
}
