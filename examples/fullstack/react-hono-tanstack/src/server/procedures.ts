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

export const getPageData: ProcedureDef = {
  input: t.object({}),
  output: t.object({
    title: t.string(),
    isAdmin: t.boolean(),
    isLoggedIn: t.boolean(),
    subtitle: t.nullable(t.string()),
    role: t.enum(["admin", "member", "guest"]),
    posts: t.array(
      t.object({
        id: t.string(),
        title: t.string(),
        isPublished: t.boolean(),
        priority: t.enum(["high", "medium", "low"]),
        author: t.nullable(t.string()),
        tags: t.array(t.object({ name: t.string() })),
      }),
    ),
  }),
  handler: () => ({
    title: "SeamJS Dashboard",
    isAdmin: true,
    isLoggedIn: true,
    subtitle: "Compile-Time Rendering Demo",
    role: "admin",
    posts: [
      {
        id: "post-1",
        title: "Getting Started with SeamJS",
        isPublished: true,
        priority: "high",
        author: "Alice",
        tags: [{ name: "tutorial" }, { name: "intro" }],
      },
      {
        id: "post-2",
        title: "Advanced CTR Patterns",
        isPublished: false,
        priority: "medium",
        author: null,
        tags: [{ name: "advanced" }],
      },
    ],
  }),
};
