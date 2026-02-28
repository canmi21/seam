/* examples/standalone/client-vanilla/src/index.ts */

// Polyfill EventSource for non-browser runtimes (Bun / Node)
import { EventSource } from "eventsource";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).EventSource ??= EventSource;

import { createSeamClient } from "./generated/client.js";

const api = createSeamClient("http://localhost:3456");

// --- Query ---
const greeting = await api.greet({ name: "World" });
console.log("greet:", greeting);

const user = await api.getUser({ id: 1 });
console.log("getUser:", user);

const users = await api.listUsers({});
console.log("listUsers:", users);

// --- Command ---
const result = await api.updateEmail({ userId: 1, newEmail: "new@example.com" });
console.log("updateEmail:", result);

// --- Subscription ---
console.log("onCount: subscribing (max=3)...");
await new Promise<void>((resolve) => {
  const unsub = api.onCount({ max: 3 }, (data) => {
    console.log("  onCount event:", data);
    if (data.n >= 3) {
      unsub();
      resolve();
    }
  });
});
console.log("onCount: done");
