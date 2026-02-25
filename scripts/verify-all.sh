#!/usr/bin/env bash
# Single-command verification: format, lint, build, test.
# Usage: bash scripts/verify-all.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/ci/_lib.sh"

require_cmd cargo "https://rustup.rs"
require_cmd bun   "https://bun.sh"
require_cmd go    "https://go.dev/dl"

bash "$DIR/ci/fmt-check.sh"

run_parallel "build-cli" "$DIR/ci/build-cli.sh" "build-ts" "$DIR/ci/build-ts.sh"
run_parallel "lint" "$DIR/ci/lint.sh" "typecheck" "$DIR/ci/typecheck.sh" "test-rs" "$DIR/ci/test-rs.sh" "test-ts" "$DIR/ci/test-ts.sh"

bash "$DIR/ci/build-fixtures.sh"

run_parallel "test-integration" "$DIR/ci/test-integration.sh" "test-e2e" "$DIR/ci/test-e2e.sh"

printf '\n==> All checks passed.\n'
