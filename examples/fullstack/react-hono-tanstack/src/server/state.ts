/* examples/fullstack/react-hono-tanstack/src/server/state.ts */

export interface Message {
  id: string;
  text: string;
  createdAt: string;
}

// In-memory store
export const messages: Message[] = [
  { id: "seed-1", text: "Welcome to SeamJS!", createdAt: new Date().toISOString() },
];

// Push-based subscriber registry for SSE
type Listener = (msg: Message) => void;
const listeners = new Set<Listener>();

export function addListener(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function notifySubscribers(msg: Message): void {
  for (const fn of listeners) fn(msg);
}
