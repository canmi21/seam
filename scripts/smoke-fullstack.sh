#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE="$ROOT/examples/fullstack/react-hono-tanstack"

# 1. Build seam CLI
echo "Building seam CLI..."
cargo build -p seam-cli --release

# 2. Run seam build in fullstack example
echo "Running seam build (fullstack)..."
(cd "$EXAMPLE" && "$ROOT/target/release/seam" build)

# 3. Run Go fullstack tests (HTTP-level)
echo "Running Go fullstack tests..."
(cd "$ROOT/tests/fullstack" && go test -v -count=1)

# 4. Build E2E fixture
echo "Building E2E fixture..."
(cd "$ROOT/tests/e2e/fixture" && "$ROOT/target/release/seam" build)

# 5. Run Playwright E2E (browser-level)
echo "Running Playwright E2E tests..."
(cd "$ROOT/tests/e2e" && bunx playwright test)

echo "All smoke tests passed."
