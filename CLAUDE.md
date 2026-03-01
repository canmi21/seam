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
- When self-review reveals potential improvements (performance, design, consistency) that fall outside the current task scope, raise them with the user for discussion rather than silently deferring or silently applying

## Version Control

- Before every `git commit`, run `bun fmt && bun lint` and fix any errors first; for TS-only changes also run `bun run test:ts`, for Rust changes run `bun run test:rs`
- For full verification (fmt + lint + build + all tests): `bun run verify`
- Run `git commit` after each plan mode phase completes, do not push
- Commit messages: conventional commit format (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, `deps:`, `revert:`, `perf:`), optionally scoped (e.g. `feat(cli):`)
- Commit messages must not mention version bumps (e.g. "bump 0.4.9") — version bumps are handled by `bump-version.sh` and staged into the last logical commit silently
- Never add AI co-authorship (e.g., "Co-Authored-By: Claude")

## Versioning

- Single source of truth: `Cargo.toml` workspace `version` field; all packages share one version
- After completing a set of business-logic changes (e.g. a plan mode session), bump patch in the final commit: run `bash scripts/bump-version.sh x.y.(z+1)` then stage the version changes alongside the last logical commit — do not create a separate `chore: bump version` commit
- Only bump minor (`x.(y+1).0`, patch resets to 0) for breaking changes: architecture shifts, API incompatibilities, or removed functionality — this **requires explicit user confirmation** before proceeding
- Chore-only changes (docs, CI, formatting, tooling) and test-only changes do not bump the version
- Go modules are not yet covered by `bump-version.sh`; version managed separately via git tags when needed

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

## Defaults vs Hard-coded Values

- Never hard-code values that users might want to customize (cookie names, param names, storage keys, header names, etc.)
- Always provide a sensible default but accept user override via parameter or option
- Rule of thumb: if a user can encounter or configure the value, it must be configurable

## Long-running Tasks

- Use `Bash` with `run_in_background: true` for long-running tasks (builds, full test suites)
- Do not block the main terminal; continue other work while waiting
- Full verification (`bun run verify`) procedure:
  1. Start in background: `Bash(command: "bun run verify", run_in_background: true)` — note the returned `task_id`
  2. Poll every 15s: `TaskOutput(task_id, block: false, timeout: 15000)` — compare output with previous poll to detect stalls (no new output for 30s+ = likely stuck)
  3. On completion the system auto-notifies; read final output and report the last 20 lines to the user
- For persistent server processes (dev servers), use tmux: `tmux new-session -d -s <name> '<command>'`

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
- Go integration tests: separate test directory per backend type (`tests/integration/` for standalone, `tests/fullstack/` for fullstack, `tests/i18n/` for i18n, `tests/workspace-integration/` for workspace backends)
- SSE endpoint tests need a mechanism to trigger data flow (e.g. post a message) since long-lived streams may not flush headers until first chunk

## Running Tests

| Command                    | Scope                                                            |
| -------------------------- | ---------------------------------------------------------------- |
| `bun run test:rs`          | Rust unit tests (`cargo test --workspace`)                       |
| `bun run test:ts`          | TS unit tests (vitest across 11 packages)                        |
| `bun run test:unit`        | All unit tests (Rust + TS)                                       |
| `bun run test:integration` | Go integration tests (standalone + fullstack + i18n + workspace) |
| `bun run test:e2e`         | Playwright E2E tests                                             |
| `bun run test`             | All layers (unit + integration + e2e), fail-fast                 |
| `bun run typecheck`        | TypeScript type checking across all TS packages                  |
| `bun run verify`           | Full pipeline: fmt + lint + build + all tests                    |

- Integration and E2E tests require fullstack build output: `cd examples/github-dashboard/seam-app && seam build`
- `scripts/smoke-fullstack.sh` runs the full build-and-test pipeline for integration + E2E

## CLI Binary

- Always use the locally compiled CLI from `target/release/seam`, never the system-installed binary
- `cargo build -p seam-cli --release` builds it; Rust incremental caching makes no-op rebuilds fast
- `scripts/verify-all.sh` and `scripts/smoke-fullstack.sh` already handle this automatically
