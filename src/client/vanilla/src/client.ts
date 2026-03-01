/* src/client/vanilla/src/client.ts */

import { SeamClientError } from "./errors.js";
import { createChannelHandle } from "./channel-handle.js";
import { createWsChannelHandle } from "./ws-channel-handle.js";
import type { ChannelHandle } from "./channel-handle.js";

export interface ClientOptions {
  baseUrl: string;
  batchEndpoint?: string;
  channelTransports?: Record<string, ChannelTransport>;
}

export type Unsubscribe = () => void;

export type ChannelTransport = "http" | "ws";

export interface ChannelOptions {
  transport?: ChannelTransport;
}

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
  channel(name: string, input: unknown, opts?: ChannelOptions): ChannelHandle;
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

function createAutoChannelHandle(
  baseUrl: string,
  client: SeamClient,
  name: string,
  input: unknown,
): ChannelHandle {
  if (typeof WebSocket === "undefined") {
    return createChannelHandle(client, name, input);
  }

  const trackedListeners: Array<[string, (data: unknown) => void]> = [];
  let delegate: ChannelHandle;
  let fallen = false;

  function fallbackToHttp(): void {
    if (fallen) return;
    fallen = true;
    delegate.close();
    delegate = createChannelHandle(client, name, input);
    for (const [e, cb] of trackedListeners) delegate.on(e, cb);
  }

  delegate = createWsChannelHandle(baseUrl, name, input, fallbackToHttp);

  return new Proxy<ChannelHandle>(
    {
      on(event: string, callback: (data: unknown) => void): void {
        trackedListeners.push([event, callback]);
        delegate.on(event, callback);
      },
      close(): void {
        delegate.close();
      },
    },
    {
      get(target, prop) {
        if (prop === "on" || prop === "close") return target[prop];
        if (typeof prop === "string") {
          return (msgInput: unknown) => {
            const method = (delegate as Record<string, unknown>)[prop];
            if (typeof method === "function")
              return (method as (input: unknown) => Promise<unknown>)(msgInput);
            return Promise.reject(new Error(`Unknown method: ${prop}`));
          };
        }
        return undefined;
      },
    },
  );
}

export function createClient(opts: ClientOptions): SeamClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const batchPath = opts.batchEndpoint ?? "_batch";
  const channelTransports = opts.channelTransports;

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

    channel(name, input, channelOpts) {
      const transport = channelOpts?.transport ?? channelTransports?.[name] ?? "http";
      if (transport === "ws") {
        return createAutoChannelHandle(baseUrl, this, name, input);
      }
      return createChannelHandle(this, name, input);
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
