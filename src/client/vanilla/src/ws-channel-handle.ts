/* src/client/vanilla/src/ws-channel-handle.ts */

import { SeamClientError } from "./errors.js";
import type { ChannelHandle } from "./channel-handle.js";

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: SeamClientError) => void;
}

interface DownlinkResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; transient: boolean };
}

interface DownlinkPush {
  event: string;
  payload: unknown;
}

let reqCounter = 0;

function nextId(): string {
  return `ws_${++reqCounter}`;
}

function handleDownlink(
  msg: Record<string, unknown>,
  pending: Map<string, PendingRequest>,
  listeners: Map<string, Set<(data: unknown) => void>>,
): void {
  if ("heartbeat" in msg) return;

  // Response to a command request
  if ("id" in msg && typeof msg.id === "string") {
    const resp = msg as unknown as DownlinkResponse;
    const entry = pending.get(resp.id);
    if (!entry) return;
    pending.delete(resp.id);
    if (resp.ok) {
      entry.resolve(resp.data);
    } else {
      const err = resp.error;
      entry.reject(
        new SeamClientError(err?.code ?? "INTERNAL_ERROR", err?.message ?? "Unknown error", 0),
      );
    }
    return;
  }

  // Push event from subscription
  if ("event" in msg && typeof msg.event === "string") {
    const push = msg as unknown as DownlinkPush;
    const cbs = listeners.get(push.event);
    if (cbs) for (const cb of cbs) cb(push.payload);
  }
}

/**
 * Create a channel handle that communicates over a single WebSocket
 * instead of HTTP POST (commands) + SSE (subscriptions).
 */
export function createWsChannelHandle(
  baseUrl: string,
  channelName: string,
  channelInput: unknown,
  onConnectionError?: () => void,
): ChannelHandle {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const pending = new Map<string, PendingRequest>();
  let ws: WebSocket | null = null;
  let closed = false;
  let hasReceived = false;

  function connect(): void {
    if (ws || closed) return;

    const wsUrl = baseUrl.replace(/^http/, "ws");
    const params = new URLSearchParams({ input: JSON.stringify(channelInput) });
    ws = new WebSocket(`${wsUrl}/_seam/procedure/${channelName}.events?${params.toString()}`);

    ws.onmessage = (evt) => {
      hasReceived = true;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(evt.data as string) as Record<string, unknown>;
      } catch {
        return;
      }
      handleDownlink(msg, pending, listeners);
    };

    ws.onclose = () => {
      ws = null;
      if (!hasReceived && onConnectionError && !closed) {
        onConnectionError();
        return;
      }
      for (const [, entry] of pending) {
        entry.reject(new SeamClientError("INTERNAL_ERROR", "WebSocket closed", 0));
      }
      pending.clear();
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  function sendUplink(msgInput: unknown, prop: string): Promise<unknown> {
    connect();
    return new Promise<unknown>((resolve, reject) => {
      const id = nextId();
      pending.set(id, { resolve, reject });
      const msg = { id, procedure: `${channelName}.${prop}`, input: msgInput ?? {} };
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      } else if (ws) {
        const onOpen = () => {
          ws?.removeEventListener("open", onOpen);
          ws?.send(JSON.stringify(msg));
        };
        ws.addEventListener("open", onOpen);
      } else {
        reject(new SeamClientError("INTERNAL_ERROR", "WebSocket not available", 0));
        pending.delete(id);
      }
    });
  }

  return new Proxy<ChannelHandle>(
    {
      on(event: string, callback: (data: unknown) => void): void {
        let cbs = listeners.get(event);
        if (!cbs) {
          cbs = new Set();
          listeners.set(event, cbs);
        }
        cbs.add(callback);
        connect();
      },
      close(): void {
        closed = true;
        if (ws) {
          ws.close();
          ws = null;
        }
        for (const [, entry] of pending) {
          entry.reject(new SeamClientError("INTERNAL_ERROR", "Channel closed", 0));
        }
        pending.clear();
        listeners.clear();
      },
    },
    {
      get(target, prop) {
        if (prop === "on" || prop === "close") return target[prop];
        if (typeof prop === "string") return (msgInput: unknown) => sendUplink(msgInput, prop);
        return undefined;
      },
    },
  );
}
