#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> TS unit tests\n'
(cd "$ROOT" && bun run test:ts)
