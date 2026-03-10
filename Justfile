# SeamJS — unified task runner
# Usage: just <recipe>   |   just --list

set dotenv-load := true
set shell := ["bash", "-euo", "pipefail", "-c"]

# Package manager

pm := "bun"

# List all recipes
default:
    @just --list

# Format + lint (pre-commit gate)
pre-commit: fmt lint

# Run all formatters
fmt:
    chore .
    {{ pm }} run fmt:ts
    {{ pm }} run fmt:md
    cargo fmt --all
    gofmt -w .

# Format TS only (oxfmt)
fmt-ts:
    {{ pm }} run fmt:ts

# Format markdown (dprint)
fmt-md:
    {{ pm }} run fmt:md

# Format Rust
fmt-rust:
    cargo fmt --all

# Format Go
fmt-go:
    gofmt -w .

# Normalize file paths (chore)
fmt-path:
    chore .

# Check formatting without writing
fmt-check:
    {{ pm }} run fmt:ts:check
    {{ pm }} run fmt:md:check
    cargo fmt --all -- --check
    test -z "$(gofmt -l .)"

# Run all linters
lint: lint-ts lint-clippy lint-go lint-length

# Lint TS (oxlint + eslint)
lint-ts:
    {{ pm }} run lint:ox
    {{ pm }} run lint:eslint

# Lint TS — oxlint only (no build artifacts needed)
lint-ox:
    {{ pm }} run lint:ox

# Lint Rust (clippy)
lint-clippy:
    cargo clippy --workspace --all-features --all-targets -- -D warnings

# Lint Go (golangci-lint per module)
lint-go:
    #!/usr/bin/env bash
    set -euo pipefail
    status=0
    while IFS= read -r mod; do
      dir="$(dirname "$mod")"
      rel="${dir#"$(pwd)"/}"
      printf '  -> %s\n' "$rel"
      (cd "$dir" && golangci-lint run ./...) || status=1
    done < <(find . -name go.mod -not -path '*/vendor/*')
    exit $status

# Warn about files exceeding 500 lines
lint-length:
    bash scripts/lint-length.sh

# Audit all lint-suppression markers (manual, not in default lint)
lint-suppressions:
    bash scripts/lint-suppressions.sh

# Check unlisted dependencies (knip)
lint-deps:
    {{ pm }} run lint:deps

# Check markdown links
lint-links:
    bash scripts/ci/check-links.sh

# Aggregate lint for CI check job (no build artifacts needed; excludes eslint and clippy)
lint-check: lint-ox lint-go lint-deps lint-links

# Aggregate lint for CI build job (requires TS build artifacts)
lint-eslint:
    {{ pm }} run lint:eslint

# Auto-fix lint issues
lint-fix:
    {{ pm }} run lint:ox:fix
    {{ pm }} run lint:eslint:fix

# Build TS + Rust
build: build-ts build-rs

# Build TS phase 1 (leaf packages, no cross-deps)
build-ts-p1:
    {{ pm }} run --filter '@canmi/seam-injector' build
    {{ pm }} run --filter '@canmi/seam-injector-native' build
    {{ pm }} run --filter '@canmi/seam-engine' build
    {{ pm }} run --filter '@canmi/seam-client' build
    {{ pm }} run --filter '@canmi/seam-vite' build
    {{ pm }} run --filter '@canmi/seam-i18n' build
    {{ pm }} run --filter '@canmi/seam-router' build
    {{ pm }} run --filter '@canmi/seam-query' build
    {{ pm }} run --filter '@canmi/eslint-plugin-seam' build

# Build TS phase 2 (depends on p1)
build-ts-p2:
    {{ pm }} run --filter '@canmi/seam-server' build
    {{ pm }} run --filter '@canmi/seam-react' build
    {{ pm }} run --filter '@canmi/seam-query-react' build

# Build TS phase 3 (depends on p2)
build-ts-p3:
    {{ pm }} run --filter '@canmi/seam-adapter-hono' build
    {{ pm }} run --filter '@canmi/seam-adapter-bun' build
    {{ pm }} run --filter '@canmi/seam-adapter-node' build
    {{ pm }} run --filter '@canmi/seam-tanstack-router' build

# Build all TS packages (3-phase dependency order), then push to yalc locally if available
build-ts: build-ts-p1 build-ts-p2 build-ts-p3
    @if [[ -z "${CI:-}" ]] && command -v yalc >/dev/null 2>&1; then bash scripts/build-cli.sh && bash scripts/yalc-publish.sh --push; fi

# Build Rust workspace
build-rs:
    cargo build --workspace

# Build CLI binary (release)
build-cli:
    cargo build -p seam-cli --release

# Legacy alias; local Cargo installation has been removed.
build-cli-install: build-cli

# Build WASM packages (injector + engine)
build-wasm:
    bash src/server/injector/build-wasm.sh
    bash src/server/engine/build-wasm.sh

# Build fullstack fixtures for integration/e2e tests
build-fixtures:
    bash scripts/build-fixtures.sh

# Run all tests (unit + integration + e2e)
test: test-unit test-integration test-e2e

# Run all unit tests (Rust + TS)
test-unit: test-rs test-ts

# Rust unit tests
test-rs:
    cargo test --workspace

# TS unit tests (vitest across all packages)
test-ts:
    {{ pm }} run --filter '@canmi/seam' test
    {{ pm }} run --filter '@canmi/seam-injector' test
    {{ pm }} run --filter '@canmi/seam-server' test
    {{ pm }} run --filter '@canmi/seam-injector-native' test
    {{ pm }} run --filter '@canmi/seam-engine' test
    {{ pm }} run --filter '@canmi/seam-adapter-hono' test
    {{ pm }} run --filter '@canmi/seam-adapter-bun' test
    {{ pm }} run --filter '@canmi/seam-adapter-node' test
    {{ pm }} run --filter '@canmi/seam-client' test
    {{ pm }} run --filter '@canmi/seam-react' test
    {{ pm }} run --filter '@canmi/seam-tanstack-router' test
    {{ pm }} run --filter '@canmi/seam-router' test
    {{ pm }} run --filter '@canmi/eslint-plugin-seam' test
    {{ pm }} run --filter '@canmi/seam-i18n' test
    {{ pm }} run --filter '@canmi/seam-vite' test
    {{ pm }} run --filter '@canmi/seam-cli' test
    {{ pm }} run --filter '@canmi/seam-query' test
    {{ pm }} run --filter '@canmi/seam-query-react' test

# Go unit tests
test-go:
    cd src/server/core/go && go test -v -count=1 ./...

# Go integration tests (standalone + fullstack + i18n + fs-router + features + workspace)
test-integration:
    bash scripts/test-integration.sh

# Playwright E2E tests
test-e2e:
    cd tests/e2e && {{ pm }}x playwright test

# TypeScript type checking
typecheck:
    bash scripts/typecheck-ts.sh

# Full verification pipeline (fmt + lint + build + all tests)
verify:
    bash scripts/verify-all.sh

# Smoke test (build + integration + e2e)
smoke:
    bash scripts/smoke-fullstack.sh

# Publish packages
publish *ARGS:
    bash scripts/publish.sh {{ ARGS }}

# Bump version across all packages
bump VERSION:
    bash scripts/bump-version.sh {{ VERSION }}

# Cross-compile CLI binaries
build-cli-cross *ARGS:
    bash scripts/build-cli.sh {{ ARGS }}

# Push commits and local-only tags to remote
push:
    #!/usr/bin/env bash
    set -euo pipefail
    BRANCH=$(git rev-parse --abbrev-ref HEAD)
    BEHIND_AHEAD=$(git rev-list --left-right --count "origin/$BRANCH...$BRANCH" 2>/dev/null || echo "0 0")
    AHEAD=$(echo "$BEHIND_AHEAD" | awk '{print $2}')
    if [ "$AHEAD" -gt 0 ]; then
      echo "Pushing $AHEAD commit(s) to origin/$BRANCH..."
      git push
    else
      echo "No unpushed commits."
    fi
    LOCAL_TAGS=$(git tag -l)
    REMOTE_TAGS=$(git ls-remote --tags origin 2>/dev/null | awk '{print $2}' | sed 's|refs/tags/||')
    NEW_TAGS=()
    for tag in $LOCAL_TAGS; do
      if ! echo "$REMOTE_TAGS" | grep -qx "$tag"; then
        NEW_TAGS+=("$tag")
      fi
    done
    if [ ${#NEW_TAGS[@]} -gt 0 ]; then
      echo "Pushing ${#NEW_TAGS[@]} new tag(s):"
      for tag in "${NEW_TAGS[@]}"; do echo "  $tag"; done
      git push --tags
    else
      echo "No new tags to push."
    fi

# Install dependencies + local build artifacts
inst:
    {{ pm }} install
    cargo build -p seam-cli --release

# Remove all build artifacts, caches, and dependencies
clean: clean-rust clean-ts clean-wasm clean-seam clean-go clean-test clean-deps

# Remove Rust build artifacts (target/)
clean-rust:
    cargo clean

# Remove TS build output (dist/ across all packages)
clean-ts:
    find . -type d -name dist -not -path '*/node_modules/*' -not -path '*/target/*' -not -path '*/.seam/*' -not -path '*/.git/*' -exec rm -rf {} +

# Remove WASM build output (pkg/ dirs, not Go committed .wasm files)
clean-wasm:
    rm -rf src/server/engine/wasm/pkg src/server/injector/wasm/pkg
    rm -rf src/server/engine/js/pkg src/server/injector/js/pkg

# Remove seam build output (.seam/ dirs in examples and tests)
clean-seam:
    find examples tests -type d -name .seam -exec rm -rf {} +

# Remove Go compiled binaries and test cache
clean-go:
    rm -f examples/github-dashboard/backends/go-gin/server
    rm -f examples/standalone/server-go/server-go
    rm -f examples/standalone/server-go-chi/server-go-chi
    rm -f examples/markdown-demo/server-go/server-go
    go clean -testcache

# Remove test artifacts (Playwright results)
clean-test:
    rm -rf tests/e2e/test-results tests/e2e/playwright-report

# Remove all node_modules (requires bun install to restore)
clean-deps:
    find . -type d -name node_modules -not -path '*/node_modules/*' -exec rm -rf {} +

# Publish all TS packages to yalc local store
yalc-publish:
    bash scripts/yalc-publish.sh

# Publish + push updates to linked projects
yalc-push:
    bash scripts/yalc-publish.sh --push

# Build all TS + push to yalc (alias for build-ts)
yalc: build-ts

# Lines of code statistics
scol:
    tokei
