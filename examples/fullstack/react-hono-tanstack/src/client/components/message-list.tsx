/* examples/fullstack/react-hono-tanstack/src/client/components/message-list.tsx */

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMessages, addMessage, subscribeMessages, type Message } from "../seam.js";

export function MessageList() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages"],
    queryFn: getMessages,
  });

  const mutation = useMutation({
    mutationFn: (newText: string) => addMessage(newText),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages"] }),
  });

  useEffect(() => {
    const unsub = subscribeMessages((msg: Message) => {
      queryClient.setQueryData<Message[]>(["messages"], (old = []) => {
        if (old.some((m) => m.id === msg.id)) return old;
        return [...old, msg];
      });
    });
    return unsub;
  }, [queryClient]);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    mutation.mutate(trimmed);
    setText("");
  };

  if (isLoading) {
    return (
      <div className="mx-auto max-w-xl px-4 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
          Message Board
        </h1>
        <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
          RPC query + mutation via TanStack Query, real-time SSE subscription
        </p>
        <div className="mt-6">
          <p className="p-8 text-sm text-neutral-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">
        Message Board
      </h1>
      <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
        RPC query + mutation via TanStack Query, real-time SSE subscription
      </p>

      <ul
        ref={listRef}
        className="mt-6 max-h-96 divide-y divide-neutral-100 overflow-y-auto dark:divide-neutral-800"
      >
        {messages.map((m) => (
          <li key={m.id} className="flex items-baseline gap-3 py-2.5">
            <time className="shrink-0 text-[11px] tabular-nums text-neutral-400 dark:text-neutral-500">
              {new Date(m.createdAt).toLocaleTimeString()}
            </time>
            <span className="text-sm text-neutral-800 dark:text-neutral-200">{m.text}</span>
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm
            text-neutral-900 outline-none placeholder:text-neutral-400
            focus:border-neutral-400 focus:ring-1 focus:ring-neutral-400
            dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100
            dark:placeholder:text-neutral-500 dark:focus:border-neutral-500
            dark:focus:ring-neutral-500"
        />
        <button
          type="submit"
          disabled={mutation.isPending}
          className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-medium text-white
            hover:bg-neutral-800 disabled:opacity-40
            dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200"
        >
          Send
        </button>
      </form>

      <p className="mt-6 text-center text-[11px] text-neutral-400 dark:text-neutral-500">
        Powered by SeamJS + Hono + TanStack Query
      </p>
    </div>
  );
}
