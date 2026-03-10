# SeamJS — Agent Instructions

This file provides instructions for AI coding agents working on this codebase.

## Hierarchical Instructions

This project uses a two-level instruction system:

1. **Root `CLAUDE.md`** — project-wide rules covering communication, version control, naming, testing, and code style. Read it first.
2. **Package `CLAUDE.md`** — many subdirectories contain their own `CLAUDE.md` with package-specific architecture, conventions, and gotchas. When working on files within a package, **always read its local `CLAUDE.md`** before making changes.

Current packages with local instructions:

```
src/cli/core/CLAUDE.md            # CLI binary
src/cli/codegen/CLAUDE.md         # TypeScript codegen
src/cli/skeleton/CLAUDE.md        # Skeleton extraction
src/cli/seam/CLAUDE.md            # defineConfig + types
src/server/core/typescript/CLAUDE.md  # Server core (TS)
src/server/core/rust/CLAUDE.md        # Server core (Rust)
src/server/core/rust-macros/CLAUDE.md # Proc macros
src/server/core/go/CLAUDE.md         # Server core (Go)
src/server/engine/rust/CLAUDE.md      # Engine (Rust)
src/server/engine/js/CLAUDE.md        # Engine (JS/WASM bridge)
src/server/engine/go/CLAUDE.md        # Engine (Go/WASM bridge)
src/server/adapter/axum/CLAUDE.md     # Axum adapter
src/server/adapter/hono/CLAUDE.md     # Hono adapter
src/server/adapter/bun/CLAUDE.md      # Bun adapter
src/server/adapter/node/CLAUDE.md     # Node adapter
src/server/injector/native/CLAUDE.md  # Native injector (frozen)
src/server/injector/go/CLAUDE.md      # Go injector (deprecated)
src/eslint/CLAUDE.md                  # ESLint plugin
tests/integration/CLAUDE.md           # Go integration tests
tests/fullstack/CLAUDE.md             # Fullstack tests
```

New packages should include a `CLAUDE.md` following the same pattern.

## Project Overview

SeamJS is a full-stack web framework with a monorepo containing Rust crates, TypeScript packages, and Go modules. The build system uses `just` as the task runner, `bun` as the package manager, and `cargo` for Rust.

## Essential Rules

- **Language**: code, comments, commits, and docs in English
- **Commit format**: conventional commits (`feat:`, `fix:`, `refactor:`, etc.); no AI co-authorship lines
- **Pre-commit**: run `just fmt && just lint` before every commit; for TS changes also `just test-ts`, for Rust changes `just test-rs`
- **Naming**: kebab-case for files/dirs/npm packages; snake_case for Rust code
- **No hard-coded values**: anything a user might configure must accept overrides with sensible defaults
- **Comments**: explain why, not what; never state the obvious
- **File headers**: every source file starts with `/* path/to/file */`
- **Nesting**: max 4 levels from `src/`

## Build & Test Commands

| Command                 | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| `just build`            | Build all (TS + Rust)                         |
| `just build-cli`        | Build CLI release binary                      |
| `just fmt`              | Format all code (Rust + TS + Go)              |
| `just lint`             | Lint all code                                 |
| `just test-rs`          | Rust unit tests                               |
| `just test-ts`          | TS unit tests (vitest)                        |
| `just test-unit`        | All unit tests (Rust + TS)                    |
| `just test-integration` | Go integration tests                          |
| `just test-e2e`         | Playwright E2E tests                          |
| `just verify`           | Full pipeline: fmt + lint + build + all tests |

## Key Gotchas

- CLI crate is named `seam-cli`; `cargo build -p seam` does NOT work
- `engine.wasm` at `src/server/engine/go/engine.wasm` must be committed (Go modules need it in git)
- Always use the locally built CLI (`target/release/seam`), not system-installed
- Node adapter has its own `sendResponse`; only `serialize` is shared with Web Response adapters
- Build output lives in `.seam/dist/`, assembled pages in `.seam/output/`
