/* examples/fullstack/react-hono-tanstack/src/client/seam.ts */

import { createClient } from "@canmi/seam-client";
import type { SeamClient } from "@canmi/seam-client";

// In dev, Vite proxy forwards /_seam/* to the backend
const client: SeamClient = createClient({ baseUrl: window.location.origin });

// -- Typed wrappers --

export interface Message {
  id: string;
  text: string;
  createdAt: string;
}

export function getMessages(): Promise<Message[]> {
  return client.call("getMessages", {}) as Promise<Message[]>;
}

export function addMessage(text: string): Promise<Message> {
  return client.call("addMessage", { text }) as Promise<Message>;
}

export function subscribeMessages(
  onData: (msg: Message) => void,
  onError?: (err: Error) => void,
): () => void {
  return client.subscribe("onMessage", {}, onData as (d: unknown) => void, onError);
}
