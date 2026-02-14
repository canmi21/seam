/* examples/fullstack/react-hono-tanstack/src/server/subscriptions.ts */

import { t, fromCallback } from "@canmi/seam-server";
import type { SubscriptionDef } from "@canmi/seam-server";
import { addListener, type Message } from "./state.js";

export const onMessage: SubscriptionDef<Record<string, never>, Message> = {
  type: "subscription",
  input: t.object({}),
  output: t.object({
    id: t.string(),
    text: t.string(),
    createdAt: t.string(),
  }),
  handler: () =>
    fromCallback<Message>((sink) => {
      const remove = addListener((msg) => sink.emit(msg));
      // Clean up when the client disconnects
      return () => remove();
    }),
};
