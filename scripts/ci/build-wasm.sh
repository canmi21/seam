#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Build WASM packages\n'
(cd "$ROOT" && pnpm build:wasm)
