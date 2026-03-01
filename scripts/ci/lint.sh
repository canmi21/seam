#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Lint (oxlint + eslint + clippy)\n'
(cd "$ROOT" && bun lint)

printf '\n==> Check unlisted dependencies (knip)\n'
(cd "$ROOT" && bunx knip --include unlisted)

printf '\n==> Check markdown links\n'
bash "$ROOT/scripts/ci/check-links.sh"
