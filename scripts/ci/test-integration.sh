#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Go integration tests\n'
(cd "$ROOT/tests/integration" && go test -v -count=1)
(cd "$ROOT/tests/fullstack" && go test -v -count=1)
