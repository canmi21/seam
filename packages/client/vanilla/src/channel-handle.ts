/* packages/client/vanilla/src/channel-handle.ts */

import type { SeamClient, Unsubscribe } from "./client.js";

export interface ChannelHandle {
  on(event: string, callback: (data: unknown) => void): void;
  close(): void;
  [method: string]:
    | ((input: unknown) => Promise<unknown>)
    | ChannelHandle["on"]
    | ChannelHandle["close"];
}

export function createChannelHandle(
  client: SeamClient,
  channelName: string,
  channelInput: unknown,
): ChannelHandle {
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  let unsub: Unsubscribe | null = null;

  function ensureSubscription(): void {
    if (unsub) return;
    unsub = client.subscribe(`${channelName}.events`, channelInput, (raw) => {
      const event = raw as { type: string; payload: unknown };
      const cbs = listeners.get(event.type);
      if (cbs) for (const cb of cbs) cb(event.payload);
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
        ensureSubscription();
      },
      close(): void {
        if (unsub) {
          unsub();
          unsub = null;
        }
        listeners.clear();
      },
    },
    {
      get(target, prop) {
        if (prop === "on" || prop === "close") return target[prop];
        if (typeof prop === "string") {
          // Dynamic message method: merges channel input with message input
          return (msgInput: unknown) =>
            client.command(`${channelName}.${prop}`, {
              ...(channelInput as object),
              ...(msgInput as object),
            });
        }
        return undefined;
      },
    },
  );
}
