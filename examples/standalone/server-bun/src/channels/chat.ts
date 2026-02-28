/* examples/standalone/server-bun/src/channels/chat.ts */

import { EventEmitter } from "node:events";
import { t, createChannel, fromCallback } from "@canmi/seam-server";

// In-memory event bus keyed by roomId
const rooms = new Map<string, EventEmitter>();

function getRoom(roomId: string): EventEmitter {
  let room = rooms.get(roomId);
  if (!room) {
    room = new EventEmitter();
    rooms.set(roomId, room);
  }
  return room;
}

// Outgoing event types
interface NewMessagePayload {
  id: string;
  text: string;
  from: string;
  timestamp: number;
}

interface TypingPayload {
  user: string;
}

type ChatEvent =
  | { type: "newMessage"; payload: NewMessagePayload }
  | { type: "typing"; payload: TypingPayload };

let nextId = 1;

export const chat = createChannel("chat", {
  input: t.object({ roomId: t.string() }),

  incoming: {
    sendMessage: {
      input: t.object({ text: t.string() }),
      output: t.object({ id: t.string(), timestamp: t.float64() }),
      handler: ({ input }) => {
        const { roomId, text } = input as { roomId: string; text: string };
        const id = String(nextId++);
        const timestamp = Date.now();
        const room = getRoom(roomId);
        room.emit("event", {
          type: "newMessage",
          payload: { id, text, from: "anonymous", timestamp },
        } satisfies ChatEvent);
        return { id, timestamp };
      },
    },
    sendTyping: {
      input: t.object({}),
      output: t.object({}),
      handler: ({ input }) => {
        const { roomId } = input as { roomId: string };
        const room = getRoom(roomId);
        room.emit("event", {
          type: "typing",
          payload: { user: "anonymous" },
        } satisfies ChatEvent);
        return {};
      },
    },
  },

  outgoing: {
    newMessage: t.object({
      id: t.string(),
      text: t.string(),
      from: t.string(),
      timestamp: t.float64(),
    }),
    typing: t.object({
      user: t.string(),
    }),
  },

  subscribe: ({ input }) => {
    const room = getRoom(input.roomId);
    return fromCallback<ChatEvent>(({ emit }) => {
      const handler = (event: ChatEvent) => emit(event);
      room.on("event", handler);
      return () => room.off("event", handler);
    });
  },
});
