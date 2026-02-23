#!/usr/bin/env bash
# Single-command verification: format, lint, build, test.
# Usage: bash scripts/verify-all.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

bash "$DIR/ci/fmt.sh"
bash "$DIR/ci/lint.sh"
bash "$DIR/ci/build-cli.sh"
bash "$DIR/ci/build-ts.sh"
bash "$DIR/ci/test-rs.sh"
bash "$DIR/ci/test-ts.sh"
bash "$DIR/ci/build-fixtures.sh"
bash "$DIR/ci/test-integration.sh"
bash "$DIR/ci/test-e2e.sh"

printf '\n==> All checks passed.\n'
