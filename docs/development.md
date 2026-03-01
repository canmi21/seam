# Development

## Prerequisites

- [Bun](https://bun.sh/) — TypeScript build and test
- [Cargo](https://www.rust-lang.org/tools/install) — Rust build and test
- [Go](https://go.dev/) — integration tests

## Setup

```bash
bun install
```

## Build

```bash
bun run build:ts         # All TypeScript packages
cargo build --workspace  # All Rust crates
```

## Test

| Command                    | Scope                                            |
| -------------------------- | ------------------------------------------------ |
| `bun run test:rs`          | Rust unit tests (`cargo test --workspace`)       |
| `bun run test:ts`          | TS unit tests (vitest across all TS packages)    |
| `bun run test:unit`        | All unit tests (Rust + TypeScript)               |
| `bun run test:integration` | Go integration tests                             |
| `bun run test:e2e`         | Playwright E2E tests                             |
| `bun run test`             | All layers (unit + integration + e2e)            |
| `bun run typecheck`        | TypeScript type checking across all packages     |
| `bun run verify`           | Full pipeline: format + lint + build + all tests |
