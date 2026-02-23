#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Lint (oxlint + eslint + clippy)\n'
(cd "$ROOT" && bun lint)
