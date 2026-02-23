#!/usr/bin/env bash
# Subset of verify-all.sh: CLI build + fullstack/e2e builds + integration/e2e tests.
# For full pipeline (fmt + lint + unit tests + everything), use: bun run verify
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
source "$DIR/ci/_lib.sh"

require_cmd cargo "https://rustup.rs"
require_cmd bun   "https://bun.sh"
require_cmd go    "https://go.dev/dl"

bash "$DIR/ci/build-cli.sh"
bash "$DIR/ci/build-fixtures.sh"

run_parallel "test-integration" "$DIR/ci/test-integration.sh" "test-e2e" "$DIR/ci/test-e2e.sh"

printf '\n==> All smoke tests passed.\n'
