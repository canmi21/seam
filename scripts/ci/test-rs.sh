#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Rust unit tests\n'
(cd "$ROOT" && cargo test --workspace)
