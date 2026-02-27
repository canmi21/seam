#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Build TS packages\n'
(cd "$ROOT" && pnpm build:ts)
