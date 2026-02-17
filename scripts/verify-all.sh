#!/usr/bin/env bash
# Single-command verification: format, lint, build, test.
# Usage: bash scripts/verify-all.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEAM="$ROOT/target/release/seam"
FULLSTACK="$ROOT/examples/fullstack/react-hono-tanstack"
E2E_FIXTURE="$ROOT/tests/e2e/fixture"

step() { printf '\n==> %s\n' "$1"; }

# 1. Format
step "Format (chore + oxfmt + dprint + cargo fmt)"
(cd "$ROOT" && bun fmt)

# 2. Lint
step "Lint (oxlint + eslint + clippy)"
(cd "$ROOT" && bun lint)

# 3. Build CLI binary (release, incremental cache handles no-op)
step "Build seam CLI"
cargo build -p seam-cli --release

# 4. Build TS packages (layered dependency order)
step "Build TS packages"
(cd "$ROOT" && bun run build:ts)

# 5. Rust unit tests
step "Rust unit tests"
cargo test --workspace

# 6. TS unit tests
step "TS unit tests"
(cd "$ROOT" && bun run test:ts)

# 7. Build fullstack example (needed by Go fullstack tests)
step "Build fullstack example"
(cd "$FULLSTACK" && "$SEAM" build)

# 8. Build E2E fixture (needed by Playwright)
step "Build E2E fixture"
(cd "$E2E_FIXTURE" && "$SEAM" build)

# 9. Go integration tests (standalone + fullstack)
step "Go integration tests"
(cd "$ROOT/tests/integration" && go test -v -count=1)
(cd "$ROOT/tests/fullstack" && go test -v -count=1)

# 10. Playwright E2E
step "Playwright E2E tests"
(cd "$ROOT/tests/e2e" && bunx playwright test)

printf '\n==> All checks passed.\n'
