/* examples/fullstack/react-hono-tanstack/src/server/pages/home.tsx */

import { useSeamData } from "@canmi/seam-react";
import type { Message } from "../state.js";

interface HomeData {
  messages: Message[];
}

/** SSR shell rendered at build time into an HTML skeleton */
export function HomePage() {
  const { messages } = useSeamData<HomeData>();
  return (
    <div>
      <h1>SeamJS Message Board</h1>
      <ul>
        {messages.map((m) => (
          <li key={m.id}>
            <strong>{m.createdAt}</strong>: {m.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
