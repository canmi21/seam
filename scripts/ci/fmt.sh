#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Format (chore + oxfmt + dprint + cargo fmt)\n'
(cd "$ROOT" && pnpm fmt)
