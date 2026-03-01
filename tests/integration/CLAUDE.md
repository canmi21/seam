# tests/integration

Go integration tests verifying API parity across all standalone backend implementations (TS/Bun, Rust, Node).

See root CLAUDE.md for general project rules.

## How It Works

- `TestMain` builds all backends, starts them on OS-assigned random ports (`PORT=0`), health-checks via `/_seam/manifest.json`
- Each test iterates over all backends and runs the same assertions against each
- Tests cover: manifest, RPC (query, not-found, invalid body), page rendering, static assets, SSE subscriptions

## Running

```sh
cd tests/integration && go test -v -count=1
```

- Requires `cargo`, `bun`, and `tsx` to be available
- Builds Rust crate `demo-server-rust` and TS packages before starting backends

## Test Files

| File                | Coverage                                         |
| ------------------- | ------------------------------------------------ |
| `main_test.go`      | TestMain setup/teardown, backend definitions     |
| `manifest_test.go`  | Manifest structure and procedure listing         |
| `rpc_test.go`       | RPC happy path, not-found, validation errors     |
| `page_test.go`      | Page HTML rendering, `__data` injection          |
| `subscribe_test.go` | SSE connection, Content-Type, data events        |
| `parity_test.go`    | Cross-backend response comparison                |
| `helpers_test.go`   | Shared HTTP helpers (getJSON, postJSON, getHTML) |

## Gotchas

- SSE test posts a message to trigger data flow; without this, headers may not flush (Bun behavior)
- Backends are killed via `Process.Kill()` in cleanup; stale processes will cause failures
