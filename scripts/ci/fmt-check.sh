#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Format check (oxfmt + dprint + cargo fmt)\n'
(cd "$ROOT" && bun run fmt:check)
