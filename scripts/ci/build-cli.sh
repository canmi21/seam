#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

printf '\n==> Build seam CLI\n'
(cd "$ROOT" && cargo build -p seam-cli --release)
