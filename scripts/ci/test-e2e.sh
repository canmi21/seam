#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Load .env if present (GITHUB_TOKEN raises API rate limit)
if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
fi

printf '\n==> Playwright E2E tests\n'
(cd "$ROOT/tests/e2e" && pnpm exec playwright test)
