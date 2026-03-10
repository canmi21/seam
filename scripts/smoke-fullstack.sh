#!/usr/bin/env bash
# Subset of verify-all.sh: CLI build + fullstack/e2e builds + integration/e2e tests.
# For full pipeline (fmt + lint + unit tests + everything), use: just verify
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/ci/_lib.sh"

require_cmd cargo "https://rustup.rs"
require_cmd bun   "https://bun.sh"
require_cmd go    "https://go.dev/dl"

just build-cli
just build-fixtures

run_parallel "test-integration" "just test-integration" "test-e2e" "just test-e2e"

printf '\n==> All smoke tests passed.\n'
