#!/usr/bin/env bash
# Subset of verify-all.sh: CLI build + fullstack/e2e builds + integration/e2e tests.
# For full pipeline (fmt + lint + unit tests + everything), use: bun run verify
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

bash "$DIR/ci/build-cli.sh"
bash "$DIR/ci/build-fixtures.sh"
bash "$DIR/ci/test-integration.sh"
bash "$DIR/ci/test-e2e.sh"

printf '\n==> All smoke tests passed.\n'
