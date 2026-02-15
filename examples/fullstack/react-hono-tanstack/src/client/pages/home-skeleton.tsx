/* examples/fullstack/react-hono-tanstack/src/client/pages/home-skeleton.tsx */

import { useSeamData } from "@canmi/seam-react";

interface Message {
  id: string;
  text: string;
  createdAt: string;
}

interface PageData extends Record<string, unknown> {
  messages: Message[];
}

/** SSR skeleton and hydration component for the home page */
export function HomeSkeleton() {
  const { messages } = useSeamData<PageData>();
  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Message Board
      </h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        RPC query + mutation via TanStack Query, real-time SSE subscription
      </p>
      <ul className="mt-6 space-y-3">
        {messages.map((m) => (
          <li key={m.id} className="rounded-lg border border-neutral-200 px-4 py-3 dark:border-neutral-700">
            <time className="text-xs text-neutral-400">{m.createdAt}</time>
            <span className="ml-2 text-sm text-neutral-800 dark:text-neutral-200">{m.text}</span>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-xs text-neutral-400">Powered by SeamJS</p>
    </div>
  );
}
