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

## Rust Toolchain

The workspace uses `rust-toolchain.toml` with `nightly` channel and `rustc-codegen-cranelift-preview` for fast dev builds. CI overrides this with `RUSTUP_TOOLCHAIN=stable`. Set `SEAM_STABLE=1` to use stable LLVM backend with release profile.

Crypto toggle: `crypto-ring` (default) vs `crypto-aws` feature flags. `SEAM_STABLE=1` selects `crypto-aws` via `--no-default-features --features crypto-aws`.

## Build

```bash
just build-ts   # All TypeScript packages (parallel phases via tsdown.p1/p2/p3.ts)
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
| `just test-e2e`         | Playwright E2E tests (parallel groups via `SEAM_E2E_GROUP`)                                             |
| `just test`             | All layers (unit + integration + e2e)                                                                   |
| `just typecheck`        | TypeScript type checking across all packages                                                            |
| `just smoke`            | Build + integration + E2E smoke test                                                                    |
| `just verify`           | Full pipeline: format + lint + build + all tests                                                        |

`just fmt` runs formatters in parallel (oxfmt + rustfmt + gofmt, then dprint).
