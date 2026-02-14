/* examples/fullstack/react-hono-tanstack/src/client/components/message-list.tsx */

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMessages, addMessage, subscribeMessages, type Message } from "../seam.js";

export function MessageList() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const listRef = useRef<HTMLUListElement>(null);

  // Fetch initial messages
  const { data: messages = [], isLoading } = useQuery({
    queryKey: ["messages"],
    queryFn: getMessages,
  });

  // Mutation to add a message
  const mutation = useMutation({
    mutationFn: (newText: string) => addMessage(newText),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["messages"] }),
  });

  // SSE subscription: append new messages to the query cache
  useEffect(() => {
    const unsub = subscribeMessages((msg: Message) => {
      queryClient.setQueryData<Message[]>(["messages"], (old = []) => {
        if (old.some((m) => m.id === msg.id)) return old;
        return [...old, msg];
      });
    });
    return unsub;
  }, [queryClient]);

  // Auto-scroll on new messages
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

  if (isLoading) return <p>Loading...</p>;

  return (
    <div>
      <h1>SeamJS Message Board</h1>
      <p style={{ color: "#888" }}>
        RPC query + mutation via TanStack Query, real-time SSE subscription
      </p>

      <ul ref={listRef} style={{ maxHeight: 400, overflow: "auto", padding: 0, listStyle: "none" }}>
        {messages.map((m) => (
          <li key={m.id} style={{ padding: "4px 0", borderBottom: "1px solid #eee" }}>
            <time style={{ color: "#999", fontSize: 12 }}>
              {new Date(m.createdAt).toLocaleTimeString()}
            </time>{" "}
            {m.text}
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit} style={{ marginTop: 12, display: "flex", gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          style={{ flex: 1, padding: "6px 10px" }}
        />
        <button type="submit" disabled={mutation.isPending}>
          Send
        </button>
      </form>
    </div>
  );
}
