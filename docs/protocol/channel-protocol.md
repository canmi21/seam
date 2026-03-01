# Channel Protocol Specification

## Overview

A **Channel** is a Level 1 abstraction that groups bidirectional communication into a single definition: incoming commands (client -> server) and outgoing events (server -> client). Channels are expanded into Level 0 procedure primitives at registration time, so the wire protocol reuses the existing procedure infrastructure.

Channels can be consumed over SSE (subscription only) or WebSocket (full bidirectional communication).

## Channel Definition

A channel is defined with `createChannel(name, def)` across all runtimes:

**TypeScript**:

```ts
const chat = createChannel("chat", {
  input: t.object({ roomId: t.string() }),
  incoming: {
    send: {
      input: t.object({ text: t.string() }),
      output: t.object({ id: t.string() }),
      handler: ({ input }) => {
        /* ... */
      },
    },
  },
  outgoing: {
    message: t.object({ sender: t.string(), text: t.string() }),
    joined: t.object({ user: t.string() }),
  },
  subscribe: async function* ({ input }) {
    /* yield events */
  },
});
```

**Go**:

```go
chat := seam.ChannelDef{
    Name:        "chat",
    InputSchema: map[string]any{"properties": map[string]any{"roomId": map[string]any{"type": "string"}}},
    Incoming: map[string]seam.IncomingDef{
        "send": {
            InputSchema:  map[string]any{"properties": map[string]any{"text": map[string]any{"type": "string"}}},
            OutputSchema: map[string]any{"properties": map[string]any{"id": map[string]any{"type": "string"}}},
            Handler:      func(ctx context.Context, input json.RawMessage) (any, error) { /* ... */ },
        },
    },
    Outgoing: map[string]any{
        "message": map[string]any{"properties": map[string]any{"sender": map[string]any{"type": "string"}, "text": map[string]any{"type": "string"}}},
        "joined":  map[string]any{"properties": map[string]any{"user": map[string]any{"type": "string"}}},
    },
    SubscribeHandler: func(ctx context.Context, input json.RawMessage) (<-chan seam.Event, error) { /* ... */ },
}
```

| Field       | Type                              | Description                                                     |
| ----------- | --------------------------------- | --------------------------------------------------------------- |
| `input`     | `JTDSchema`                       | Channel-level input shared across all operations.               |
| `incoming`  | `Record<string, IncomingDef>`     | Client-to-server commands. Each has its own input/output/error. |
| `outgoing`  | `Record<string, JTDSchema>`       | Server-to-client event payload schemas.                         |
| `subscribe` | `(input) -> AsyncIterable<Event>` | Yields tagged events from the `outgoing` set.                   |

## Level 1 -> Level 0 Expansion

When a channel named `chat` is registered, the framework expands it into Level 0 primitives:

### Incoming commands

Each incoming message `{msg}` becomes a **command** procedure `{channel}.{msg}`:

- Name: `chat.send`
- Type: `"command"`
- Input schema: **merge** of channel input + message input (message keys override on conflict)
- Output schema: message output
- Error schema: message error (if defined)

### Subscribe handler

The subscribe handler becomes a **subscription** `{channel}.events`:

- Name: `chat.events`
- Type: `"subscription"`
- Input schema: channel input
- Output schema: tagged union (discriminator `"type"`, mapping from event names to `{ payload: <schema> }`)

### Example expansion

Given the `chat` channel above, the manifest procedures section includes:

```json
{
  "chat.send": {
    "type": "command",
    "input": {
      "properties": {
        "roomId": { "type": "string" },
        "text": { "type": "string" }
      }
    },
    "output": {
      "properties": {
        "id": { "type": "string" }
      }
    }
  },
  "chat.events": {
    "type": "subscription",
    "input": {
      "properties": {
        "roomId": { "type": "string" }
      }
    },
    "output": {
      "discriminator": "type",
      "mapping": {
        "message": {
          "properties": {
            "payload": {
              "properties": {
                "sender": { "type": "string" },
                "text": { "type": "string" }
              }
            }
          }
        },
        "joined": {
          "properties": {
            "payload": {
              "properties": {
                "user": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

## Manifest `channels` Field

The manifest includes an optional `channels` field with `ChannelMeta` for each channel. This is an IR hint for codegen — it preserves the Level 1 structure so code generators can produce channel-aware client APIs instead of flat procedure lists.

```json
{
  "version": 1,
  "procedures": {
    /* expanded Level 0 procedures */
  },
  "channels": {
    "chat": {
      "input": { "properties": { "roomId": { "type": "string" } } },
      "incoming": {
        "send": {
          "input": { "properties": { "text": { "type": "string" } } },
          "output": { "properties": { "id": { "type": "string" } } }
        }
      },
      "outgoing": {
        "message": {
          "properties": { "sender": { "type": "string" }, "text": { "type": "string" } }
        },
        "joined": { "properties": { "user": { "type": "string" } } }
      }
    }
  }
}
```

| Field      | Type                                        | Description                      |
| ---------- | ------------------------------------------- | -------------------------------- |
| `input`    | `JTDSchema`                                 | Channel-level input schema.      |
| `incoming` | `Record<string, { input, output, error? }>` | Per-message schemas (pre-merge). |
| `outgoing` | `Record<string, JTDSchema>`                 | Per-event payload schemas.       |

## WebSocket Protocol

Channels support full bidirectional communication over WebSocket. The client upgrades the subscription endpoint to a persistent connection that carries both outgoing events and incoming command invocations.

### Connection

```
GET /_seam/procedure/{channel}.events?input={json}
Upgrade: websocket
Connection: Upgrade
```

The `input` query parameter provides the channel-level input (URL-encoded JSON). The server validates the subscription exists, parses the input, and upgrades to WebSocket.

### Server -> Client Messages

**Event** — a value from the subscription stream:

```json
{ "event": "message", "payload": { "sender": "Alice", "text": "Hello" } }
```

**Command response** — result of an uplink command:

```json
{ "id": "req-1", "ok": true, "data": { "id": "msg-42" } }
```

**Command error** — failed uplink command:

```json
{
  "id": "req-1",
  "ok": false,
  "error": { "code": "VALIDATION_ERROR", "message": "...", "transient": false }
}
```

**Heartbeat** — keep-alive signal (default interval: 30 seconds):

```json
{ "heartbeat": true }
```

**Stream error** — unrecoverable subscription error:

```json
{ "event": "__error", "payload": { "code": "INTERNAL_ERROR", "message": "..." } }
```

### Client -> Server Messages

**Uplink command** — invoke a channel command over the open connection:

```json
{ "id": "req-1", "procedure": "chat.send", "input": { "text": "Hello" } }
```

| Field       | Type     | Description                                                    |
| ----------- | -------- | -------------------------------------------------------------- |
| `id`        | `string` | Client-generated request ID. Echoed in the response.           |
| `procedure` | `string` | Fully qualified procedure name (must start with `{channel}.`). |
| `input`     | `object` | Message-level input (merged with channel input).               |

### Input Merging

When an uplink command is dispatched, the server merges channel-level input (from the connection query parameter) with the message-level input from the uplink frame. Uplink keys override channel keys on conflict.

```
channelInput = { roomId: "room-1" }        // from ?input=
uplinkInput  = { text: "Hello" }            // from WS frame
mergedInput  = { roomId: "room-1", text: "Hello" }
```

### Validation Rules

- The `procedure` field must start with `{channel}.` (e.g. `chat.send` for channel `chat`).
- The `procedure` must not be `{channel}.events` — the subscription is server-initiated, not callable.
- The `id` field is required for all uplink messages.

### Heartbeat

The server sends `{ "heartbeat": true }` at a configurable interval (default: 30 seconds) to prevent proxies and load balancers from closing idle connections. The client should silently ignore heartbeat frames.

## Transport Hint

The CLI codegen emits a `seamTransportHint` marker on generated channel clients. When the client runtime detects this marker, it automatically selects WebSocket transport for channel subscriptions instead of SSE. If the WebSocket connection fails or is unavailable, the client falls back to SSE (which supports the event stream but not uplink commands).

This is transparent to application code — developers call the same generated API regardless of the underlying transport.

## Related

- [Procedure Manifest](./procedure-manifest.md) -- manifest format and HTTP endpoints
- [Subscription Protocol](./subscription-protocol.md) -- SSE streaming specification
- [Transport Layer](../architecture/transport-layer.md) -- transport architecture overview
