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

export const getAboutData: ProcedureDef = {
  input: t.object({}),
  output: t.object({
    teamName: t.string(),
    description: t.string(),
    isHiring: t.boolean(),
    contactEmail: t.nullable(t.string()),
  }),
  handler: () => ({
    teamName: "SeamJS Core",
    description: "Building the next generation of compile-time rendering tools.",
    isHiring: true,
    contactEmail: "team@seamjs.dev",
  }),
};

export const getPosts: ProcedureDef = {
  input: t.object({}),
  output: t.object({
    heading: t.string(),
    showDrafts: t.boolean(),
    posts: t.array(
      t.object({
        id: t.string(),
        title: t.string(),
        isPublished: t.boolean(),
        excerpt: t.string(),
        author: t.nullable(t.string()),
      }),
    ),
  }),
  handler: () => ({
    heading: "Recent Posts",
    showDrafts: true,
    posts: [
      {
        id: "post-1",
        title: "Getting Started with SeamJS",
        isPublished: true,
        excerpt: "Learn how to set up CTR in your project.",
        author: "Alice",
      },
      {
        id: "post-2",
        title: "Advanced CTR Patterns",
        isPublished: false,
        excerpt: "Deep dive into multi-variant skeleton extraction.",
        author: null,
      },
    ],
  }),
};

export const getReact19Data: ProcedureDef = {
  input: t.object({}),
  output: t.object({
    heading: t.string(),
    description: t.string(),
  }),
  handler: () => ({
    heading: "React 19 Features",
    description: "Demonstrating useId, Suspense, useState, useRef, useMemo, and metadata hoisting.",
  }),
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
    title: "SeamJS",
    isAdmin: true,
    isLoggedIn: true,
    subtitle: "Compile-time rendering for React",
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
