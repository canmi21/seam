# SeamJS — Project Rules

> This file contains rules that apply to **all** packages. Package-specific conventions live in each package's own CLAUDE.md.
> Review and update these rules when project conventions change or no longer apply. Remove outdated rules rather than leaving them as dead weight.

## Communication

- Speak Chinese with the user, keep technical terms in English (e.g. procedure, manifest, codegen)
- All file content (code, comments, docs, commit messages) must be concise declarative English
- No emoji

## Decision Making

- Discuss uncertain matters with the user before proceeding
- Enter plan mode when a single request contains more than 3 tasks

## Version Control

- Before every `git commit`, run `bun fmt && bun lint` and fix any errors first
- Run `git commit` after each plan mode phase completes, do not push
- Commit messages: concise English describing the change

## Monorepo Structure

- The project uses monorepo layout; plan package boundaries upfront
- Each package has a single responsibility with clear boundaries

## Naming Convention

- Default: lowercase + hyphen (kebab-case) for file names, directory names, npm package names
- Rust code follows Rust convention: lowercase + underscore (snake_case)
- No uppercase-initial directory or file names unless forced by framework conventions

## Directory Structure

- `src/` uses nested layout organized by functional modules
- Nesting depth must not exceed 4 levels from `src/`
- Use directories to express module boundaries

## Comments

- Write comments, but never state the obvious
- Comments explain why, not what
- During refactoring, do not delete existing comments without first evaluating whether they remain relevant after the refactor

## Code Simplification

- When the user says "简化代码", run the `code-simplifier:code-simplifier` agent to refine the codebase

## Long-running Tasks

- Use tmux sessions for long-running tasks (builds, tests, server processes)
- Do not block the main terminal

## Refactoring

- Rust file split: convert `foo.rs` to `foo/mod.rs` + sub-modules; inner functions become `pub(super)`, only entry-point stays `pub`
- Verify `cargo test --workspace && cargo clippy --workspace` after every Rust structural change
- TS dedup: add shared functions to `@canmi/seam-server`, update adapters to import; node adapter keeps its own `sendResponse` (Node streams differ from Web Response)
- After TS changes: `bun run --filter '<pkg>' build && bun run --filter '<pkg>' test`

## Agent Team Strategy

- Use Agent Team (TeamCreate) when a plan has 2+ independent sub-tasks that touch different files
- Typical split: Rust agents work in parallel on separate crates/modules, lead handles TS and coordination
- Provide agents with full file contents and exact split instructions; do not rely on agents to read large files themselves
- Agents create their own sub-tasks; lead monitors via TaskList and waits with `sleep` + periodic checks
- Always run a unified verification (`cargo test --workspace`) after agents finish before committing
- Shut down agents (SendMessage shutdown_request) once their work is verified
- Discard unrelated formatter diffs (`git checkout -- <file>`) before committing to keep commits focused

## Type Dependencies

- When adding TS code that uses Node.js APIs (`path`, `fs`, `process`, etc.), ensure `@types/node` is in the package's devDependencies and tsconfig includes `"types": ["node"]`
- Same applies to other ambient types (e.g. `@types/bun`) — always verify type resolution before committing

## Testing Philosophy

- Pure stateless functions: test correct path + error path (boundary values, empty input, missing keys)
- Composition/orchestration functions: integration-level tests only, do not re-test inner functions
- Go integration tests: separate test directory per backend type (`tests/integration/` for standalone, `tests/fullstack/` for fullstack)
- SSE endpoint tests need a mechanism to trigger data flow (e.g. post a message) since long-lived streams may not flush headers until first chunk

## Running Tests

| Command                    | Scope                                         |
| -------------------------- | --------------------------------------------- |
| `bun run test:rs`          | Rust unit tests (`cargo test --workspace`)    |
| `bun run test:ts`          | TS unit tests (vitest across 6 packages)      |
| `bun run test:unit`        | All unit tests (Rust + TS)                    |
| `bun run test:integration` | Go integration tests (standalone + fullstack) |
| `bun run test:e2e`         | Playwright E2E tests                          |
| `bun run test`             | All layers, fail-fast                         |

- Integration and E2E tests require fullstack build output: `cd examples/fullstack/react-hono-tanstack && seam build`
- `scripts/smoke-fullstack.sh` runs the full build-and-test pipeline for integration + E2E
