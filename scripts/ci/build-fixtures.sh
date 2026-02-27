#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEAM="$ROOT/target/release/seam"
FULLSTACK="$ROOT/examples/github-dashboard/seam-app"
E2E_FIXTURE="$ROOT/tests/e2e/fixture"
WORKSPACE_DIR="$ROOT/examples/github-dashboard"

printf '\n==> Build fullstack example\n'
(cd "$FULLSTACK" && "$SEAM" build)

printf '\n==> Build E2E fixture\n'
(cd "$E2E_FIXTURE" && "$SEAM" build)

printf '\n==> Build i18n demo\n'
I18N_DIR="$ROOT/examples/i18n-demo/seam-app"
(cd "$I18N_DIR" && "$SEAM" build)
(cd "$ROOT" && cargo build -p i18n-demo-axum --release)

printf '\n==> Build workspace backends\n'
(cd "$ROOT" && cargo build -p github-dashboard-axum --release)
(cd "$WORKSPACE_DIR/backends/go-gin" && go build -o server .)
