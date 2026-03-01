# Logic Layer

SeamJS defines a protocol (`/_seam/*` endpoints), not a runtime. Any language that can serve HTTP and perform string replacement can be a SeamJS backend. Server-side logic is expressed as **procedures** — typed functions with JSON Type Definition (JTD) schemas — which are exposed via a manifest and consumed by auto-generated client code.

## Implemented

The engine source of truth is the Rust crate [`seam-engine`](../../src/server/engine/rust/). TypeScript and Go consume it via WASM ([`seam-engine-wasm`](../../src/server/engine/wasm/)).

|          | Rust                                                 | TypeScript                                                                                                                                       | Go                                         |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Core     | [`seam-server`](../../src/server/core/rust/)         | [`@canmi/seam-server`](../../src/server/core/typescript/)                                                                                        | [Go module](../../src/server/core/go/)     |
| Macros   | [`seam-macros`](../../src/server/core/rust-macros/)  | —                                                                                                                                                | —                                          |
| Adapter  | [`seam-server-axum`](../../src/server/adapter/axum/) | [`@canmi/seam-adapter-node`](../../src/server/adapter/node/) / [`bun`](../../src/server/adapter/bun/) / [`hono`](../../src/server/adapter/hono/) | —                                          |
| Engine   | [`seam-engine`](../../src/server/engine/rust/)       | [`@canmi/seam-engine`](../../src/server/engine/js/)                                                                                              | [`engine/go`](../../src/server/engine/go/) |
| Injector | [`seam-injector`](../../src/server/injector/rust/)   | —                                                                                                                                                | —                                          |

<details>
<summary>Deprecated packages</summary>

| Package                                              | Crate / npm                   | Replacement          |
| ---------------------------------------------------- | ----------------------------- | -------------------- |
| [injector/wasm](../../src/server/injector/wasm/)     | `seam-injector-wasm`          | `seam-engine-wasm`   |
| [injector/js](../../src/server/injector/js/)         | `@canmi/seam-injector`        | `@canmi/seam-engine` |
| [injector/go](../../src/server/injector/go/)         | Go module                     | `engine/go`          |
| [injector/native](../../src/server/injector/native/) | `@canmi/seam-injector-native` | `@canmi/seam-engine` |

</details>

## CLI

| Package                                 | Crate / npm       | Description                                                 |
| --------------------------------------- | ----------------- | ----------------------------------------------------------- |
| [cli/skeleton](../../src/cli/skeleton/) | `seam-skeleton`   | HTML skeleton extraction pipeline (slot, extract, document) |
| [cli/codegen](../../src/cli/codegen/)   | `seam-codegen`    | TypeScript codegen, manifest types, RPC hash map            |
| [cli/core](../../src/cli/core/)         | `seam-cli`        | Build orchestration, dev servers, CLI entry point           |
| [cli/pkg](../../src/cli/pkg/)           | `@canmi/seam-cli` | npm distribution wrapper for the CLI binary                 |

## Planned

- Python server core
- C# / .NET server core
- Any language via protocol implementation — PRs welcome

## How It Works

Backend developers define **procedures**: typed functions that accept structured input and return structured output. There are three procedure types: **queries** (read-only), **commands** (side effects), and **subscriptions** (streaming). Each procedure declares a JTD schema for its input and output types. At build time, the CLI reads the server's `/_seam/manifest.json` endpoint (which lists all procedures and their schemas) and generates a fully typed client SDK. At request time, the client calls procedures over HTTP or WebSocket; the server executes the handler and returns results in a standard `{ ok, data/error }` envelope.

**Channels** group related commands and subscriptions into a single definition with shared input. See [Channel Protocol](../protocol/channel-protocol.md) for the channel abstraction and WebSocket wire format.

- [Procedure Manifest](../protocol/procedure-manifest.md) — JSON schema for the manifest endpoint

## The Seam Protocol

A valid SeamJS backend implements these endpoints:

| Endpoint                         | Method | Purpose                                       |
| -------------------------------- | ------ | --------------------------------------------- |
| `/_seam/manifest.json`           | GET    | Procedure schemas, page routes, i18n config   |
| `/_seam/procedure/{name}`        | POST   | Single procedure call (query or command)      |
| `/_seam/procedure/_batch`        | POST   | Batch multiple procedure calls in one request |
| `/_seam/procedure/{name}`        | GET    | SSE streaming for subscriptions               |
| `/_seam/procedure/{name}.events` | GET+WS | WebSocket upgrade for channel subscriptions   |
| `/_seam/page/*`                  | GET    | Skeleton-injected HTML page serving           |

Any language that serves these endpoints is a valid SeamJS backend. The protocol is the contract, not the runtime.
