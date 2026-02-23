#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Playwright E2E tests\n'
(cd "$ROOT/tests/e2e" && bunx playwright test)
