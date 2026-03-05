#!/usr/bin/env bash
# Single-command verification: format, lint, build, test.
# Usage: bash scripts/verify-all.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/ci/_lib.sh"

require_cmd cargo "https://rustup.rs"
require_cmd bun   "https://bun.sh"
require_cmd go    "https://go.dev/dl"

just fmt-check

run_parallel "build-cli" "just build-cli-install" "build-wasm" "just build-wasm"
just build-ts
run_parallel "lint" "just lint-ts lint-go lint-deps lint-links" "typecheck" "just typecheck" "test-rs" "just test-rs" "test-ts" "just test-ts" "test-go" "just test-go"

just build-fixtures

run_parallel "test-integration" "just test-integration" "test-e2e" "just test-e2e"

printf '\n==> All checks passed.\n'
