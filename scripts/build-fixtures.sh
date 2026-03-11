#!/usr/bin/env bash
# scripts/build-fixtures.sh
# Build fullstack fixtures used by integration and E2E tests.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SEAM="$ROOT/target/release/seam"

printf '\n==> Build fullstack example\n'
(cd "$ROOT/examples/github-dashboard/seam-app" && "$SEAM" build)

printf '\n==> Build E2E fixture\n'
(cd "$ROOT/tests/e2e/fixture" && "$SEAM" build)

printf '\n==> Build i18n demo\n'
(cd "$ROOT/examples/i18n-demo/seam-app" && "$SEAM" build)
cargo build -p i18n-demo-axum --release

printf '\n==> Build fs-router demo\n'
(cd "$ROOT/examples/fs-router-demo" && "$SEAM" build)

printf '\n==> Build shadcn ui demo\n'
(cd "$ROOT/examples/shadcn-ui-demo" && "$SEAM" build)

printf '\n==> Build feature demos\n'
for demo in stream-upload context-auth query-mutation handoff-narrowing channel-subscription; do
  (cd "$ROOT/examples/features/$demo" && "$SEAM" build)
done

printf '\n==> Build workspace backends\n'
cargo build -p github-dashboard-axum --release
(cd "$ROOT/examples/github-dashboard/backends/go-gin" && go build -o server .)
