# Transport Layer

Procedure handlers in SeamJS are pure functions: `(input) -> output`. They know nothing about HTTP, WebSocket, or IPC. The transport layer is a separate adapter that serializes handler results to the wire format and manages connection lifecycle. This means the same business logic works unchanged across HTTP servers, desktop IPC channels, and future transport mechanisms.

## Implemented

| Channel   | Type             | Status | Packages                                   |
| --------- | ---------------- | ------ | ------------------------------------------ |
| HTTP RPC  | Request/Response | Done   | All server adapters                        |
| SSE       | Streaming        | Done   | All server adapters                        |
| Batch RPC | Request/Response | Done   | All server adapters + `@canmi/seam-client` |

## Planned

- WebSocket — bidirectional streaming for real-time applications
- Tauri IPC — desktop apps via Tauri's inter-process communication
- Electron IPC — desktop apps via Electron's IPC bridge
- Custom channels — any `AsyncIterable` source as a transport

## How It Works

A procedure handler returns a result (or yields values for subscriptions). The transport adapter takes that result and serializes it to the appropriate wire format:

- **HTTP RPC**: handler result is JSON-serialized into an HTTP response body
- **SSE**: handler yields values over time; each value becomes an SSE `data:` frame
- **Batch RPC**: multiple procedure calls are bundled into a single HTTP request; results are returned as a JSON array

The adapter handles serialization, error encoding, connection management, and protocol-specific details (CORS, content types, keep-alive). The handler never touches any of this — it is a pure data transformation.

Swapping HTTP for Tauri IPC means replacing the adapter, not the handlers. A Rust backend running inside a Tauri app uses the same procedure definitions as one running behind Axum — only the transport changes.

- [Subscription Protocol](subscription-protocol.md) — SSE streaming specification
