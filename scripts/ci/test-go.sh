#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Go unit tests\n'
(cd "$ROOT/src/server/core/go" && go test -v -count=1 ./...)
