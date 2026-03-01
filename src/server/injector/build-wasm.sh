#!/usr/bin/env bash
# src/server/injector/build-wasm.sh
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
exec bash "$REPO_ROOT/scripts/build-wasm.sh" "$REPO_ROOT/src/server/injector" injector
