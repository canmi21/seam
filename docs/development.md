# Development

## Prerequisites

- [Bun](https://bun.sh/) — TypeScript build and test
- [Cargo](https://www.rust-lang.org/tools/install) — Rust build and test
- [Go](https://go.dev/) — integration tests
- [just](https://github.com/casey/just) — task runner

## Setup

```bash
bun install
```

## Build

```bash
just build-ts   # All TypeScript packages
just build-rs   # All Rust crates
just build       # Both
```

## Test

| Command                 | Scope                                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------------------------- |
| `just test-rs`          | Rust unit tests (`cargo test --workspace`)                                                              |
| `just test-ts`          | TS unit tests (vitest across all TS packages)                                                           |
| `just test-unit`        | All unit tests (Rust + TypeScript)                                                                      |
| `just test-integration` | Go integration tests (standalone + fullstack + i18n + fs-router + features + markdown-demo + workspace) |
| `just test-e2e`         | Playwright E2E tests                                                                                    |
| `just test`             | All layers (unit + integration + e2e)                                                                   |
| `just typecheck`        | TypeScript type checking across all packages                                                            |
| `just smoke`            | Build + integration + E2E smoke test                                                                    |
| `just verify`           | Full pipeline: format + lint + build + all tests                                                        |
