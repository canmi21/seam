# Development

## Prerequisites

- [pnpm](https://pnpm.io/) — package manager
- [Cargo](https://www.rust-lang.org/tools/install) — Rust build and test
- [Go](https://go.dev/) — integration tests

## Setup

```bash
pnpm install
```

## Build

```bash
pnpm build:ts            # All TypeScript packages
cargo build --workspace  # All Rust crates
```

## Test

| Command                 | Scope                                            |
| ----------------------- | ------------------------------------------------ |
| `pnpm test:unit`        | All unit tests (Rust + TypeScript)               |
| `pnpm test:integration` | Go integration tests                             |
| `pnpm test:e2e`         | Playwright E2E tests                             |
| `pnpm test`             | All layers (unit + integration + e2e)            |
| `pnpm typecheck`        | TypeScript type checking across all packages     |
| `pnpm verify`           | Full pipeline: format + lint + build + all tests |
