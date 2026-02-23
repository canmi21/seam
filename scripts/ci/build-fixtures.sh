#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEAM="$ROOT/target/release/seam"
FULLSTACK="$ROOT/examples/github-dashboard/seam-app"
E2E_FIXTURE="$ROOT/tests/e2e/fixture"

printf '\n==> Build fullstack example\n'
(cd "$FULLSTACK" && "$SEAM" build)

printf '\n==> Build E2E fixture\n'
(cd "$E2E_FIXTURE" && "$SEAM" build)
