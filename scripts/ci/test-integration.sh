#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# Load .env if present (GITHUB_TOKEN raises API rate limit)
if [[ -f "$ROOT/.env" ]]; then
  set -a; source "$ROOT/.env"; set +a
fi

printf '\n==> Go integration tests\n'
(cd "$ROOT/tests/integration" && go test -v -count=1)
(cd "$ROOT/tests/fullstack" && go test -v -count=1)

printf '\n==> Workspace integration tests\n'
(cd "$ROOT/tests/workspace-integration" && go test -v -count=1 -timeout 120s)
