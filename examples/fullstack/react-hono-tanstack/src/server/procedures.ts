/* examples/fullstack/react-hono-tanstack/src/server/procedures.ts */

import { t } from "@canmi/seam-server";
import type { ProcedureDef } from "@canmi/seam-server";
import { messages, type Message, notifySubscribers } from "./state.js";

export const getMessages: ProcedureDef<Record<string, never>, Message[]> = {
  input: t.object({}),
  output: t.array(
    t.object({
      id: t.string(),
      text: t.string(),
      createdAt: t.string(),
    }),
  ),
  handler: () => [...messages],
};

export const addMessage: ProcedureDef<{ text: string }, Message> = {
  input: t.object({ text: t.string() }),
  output: t.object({
    id: t.string(),
    text: t.string(),
    createdAt: t.string(),
  }),
  handler: ({ input }) => {
    const msg: Message = {
      id: crypto.randomUUID(),
      text: input.text,
      createdAt: new Date().toISOString(),
    };
    messages.push(msg);
    notifySubscribers(msg);
    return msg;
  },
};
