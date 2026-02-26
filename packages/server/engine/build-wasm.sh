#!/usr/bin/env bash
# packages/server/engine/build-wasm.sh
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
exec bash "$REPO_ROOT/scripts/build-wasm.sh" "$REPO_ROOT/packages/server/engine" engine
