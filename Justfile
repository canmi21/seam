# SeamJS — unified task runner
# Usage: just <recipe>   |   just --list

set dotenv-load := true
set shell := ["bash", "-euo", "pipefail", "-c"]

# Package manager

pm := "bun"

# Cranelift fast builds: auto-detected on nightly. Set SEAM_STABLE=1 for stable LLVM + release.
_is_nightly := `rustc --version 2>&1 | grep -q nightly && echo "yes" || echo ""`
_cranelift := if _is_nightly != "" { if env_var_or_default("SEAM_STABLE", "") == "" { "CARGO_UNSTABLE_CODEGEN_BACKEND=true CARGO_PROFILE_DEV_CODEGEN_BACKEND=cranelift" } else { "" } } else { "" }
_crypto := if env_var_or_default("SEAM_STABLE", "") != "" { "--no-default-features --features crypto-aws" } else { "" }
_release := if env_var_or_default("SEAM_STABLE", "") != "" { "--release" } else { "" }
_profile := if env_var_or_default("SEAM_STABLE", "") != "" { "release" } else { "debug" }

# List all recipes
default:
    @just --list

# Format + lint (pre-commit gate)
pre-commit: fmt lint

# Run all formatters (parallel: oxfmt + rustfmt + gofmt, then dprint)
fmt:
    #!/usr/bin/env bash
    set -uo pipefail
    chore . || exit $?
    pids=(); names=()
    just fmt-ts   & pids+=($!); names+=(oxfmt)
    just fmt-rust & pids+=($!); names+=(rustfmt)
    just fmt-go   & pids+=($!); names+=(gofmt)
    failed=0
    for i in "${!pids[@]}"; do
      code=0; wait "${pids[$i]}" || code=$?
      if [ "$code" != "0" ]; then printf '==> %s FAILED (exit %s)\n' "${names[$i]}" "$code"; failed=1; fi
    done
    if [ "$failed" != "0" ]; then exit 1; fi
    just fmt-md

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

# Check formatting without writing (parallel: oxfmt + rustfmt + gofmt, then dprint)
fmt-check:
    #!/usr/bin/env bash
    set -uo pipefail
    pids=(); names=()
    {{ pm }} run fmt:ts:check &                                                          pids+=($!); names+=(oxfmt)
    cargo fmt --all -- --check &                                                         pids+=($!); names+=(rustfmt)
    bash -c 'bad=$(gofmt -l .); if [ -n "$bad" ]; then echo "$bad"; exit 1; fi' &        pids+=($!); names+=(gofmt)
    failed=0
    for i in "${!pids[@]}"; do
      code=0; wait "${pids[$i]}" || code=$?
      if [ "$code" != "0" ]; then printf '==> %s FAILED (exit %s)\n' "${names[$i]}" "$code"; failed=1; fi
    done
    if [ "$failed" != "0" ]; then exit 1; fi
    {{ pm }} run fmt:md:check

# Run all linters (parallel)
lint:
    #!/usr/bin/env bash
    set -uo pipefail
    tmpdir=$(mktemp -d)
    trap 'rm -rf "$tmpdir"' EXIT
    pids=()
    names=()
    run_task() {
      local name=$1; shift
      names+=("$name")
      "$@" >"$tmpdir/$name.log" 2>&1 &
      pids+=($!)
    }
    run_task lint-ts     bash -c 'just lint-ts'
    run_task lint-clippy bash -c 'just lint-clippy'
    run_task lint-go     bash -c 'just lint-go'
    run_task lint-length bash -c 'just lint-length'
    run_task lint-links  bash -c 'just lint-links'
    failed=0
    for i in "${!pids[@]}"; do
      code=0; wait "${pids[$i]}" || code=$?
      printf '\n==> %s (exit %s)\n' "${names[$i]}" "$code"
      cat "$tmpdir/${names[$i]}.log"
      if [ "$code" != "0" ]; then failed=1; fi
    done
    exit $failed

# Lint TS (oxlint + eslint)
lint-ts:
    {{ pm }} run lint:ox
    {{ pm }} run lint:eslint

# Lint TS — oxlint only (no build artifacts needed)
lint-ox:
    {{ pm }} run lint:ox

# Lint Rust (clippy)
lint-clippy:
    {{ _cranelift }} cargo clippy --workspace --all-targets {{ _crypto }} -- -D warnings

# Lint Go (golangci-lint per module; serial in CI, parallel locally)
lint-go:
    #!/usr/bin/env bash
    set -uo pipefail
    if [[ -n "${CI:-}" ]]; then
      max_jobs=${LINT_GO_JOBS:-1}
    else
      max_jobs=${LINT_GO_JOBS:-4}
    fi
    pids=()
    mods=()
    while IFS= read -r mod; do
      dir="$(dirname "$mod")"
      rel="${dir#"$(pwd)"/}"
      mods+=("$rel")
      (cd "$dir" && golangci-lint run --allow-parallel-runners ./...) &
      pids+=($!)
      # throttle: wait for a slot when hitting max_jobs
      if (( ${#pids[@]} % max_jobs == 0 )); then
        for pid in "${pids[@]:$(( ${#pids[@]} - max_jobs )):$max_jobs}"; do
          wait "$pid" 2>/dev/null || true
        done
      fi
    done < <(find . -name go.mod -not -path '*/vendor/*')
    failed=0
    for i in "${!pids[@]}"; do
      if ! wait "${pids[$i]}" 2>/dev/null; then
        printf '  FAIL: %s\n' "${mods[$i]}"
        failed=1
      fi
    done
    exit $failed

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

# Build TS + Rust (parallel)
build:
    #!/usr/bin/env bash
    set -uo pipefail
    pids=(); names=()
    just build-ts & pids+=($!); names+=(build-ts)
    just build-rs & pids+=($!); names+=(build-rs)
    failed=0
    for i in "${!pids[@]}"; do
      code=0; wait "${pids[$i]}" || code=$?
      if [ "$code" != "0" ]; then printf '==> %s FAILED (exit %s)\n' "${names[$i]}" "$code"; failed=1; fi
    done
    exit $failed

# Build TS phase 1 (leaf packages, no cross-deps — parallel via tsdown workspace)
build-ts-p1:
    {{ pm }} x tsdown -c tsdown.p1.ts

# Build TS phase 2 (depends on p1 — parallel via tsdown workspace)
build-ts-p2:
    {{ pm }} x tsdown -c tsdown.p2.ts

# Build TS phase 3 (depends on p2 — parallel via tsdown workspace)
build-ts-p3:
    {{ pm }} x tsdown -c tsdown.p3.ts

# Build all TS packages (3-phase dependency order), then push to yalc locally if available
build-ts: build-ts-p1 build-ts-p2 build-ts-p3
    @if [[ -z "${CI:-}" ]] && command -v yalc >/dev/null 2>&1; then bash scripts/yalc-publish.sh --push; fi

# Build Rust workspace
build-rs:
    {{ _cranelift }} cargo build --workspace {{ _crypto }}

# Build CLI binary
build-cli:
    {{ _cranelift }} cargo build -p seam-cli {{ _release }} {{ _crypto }}

# Legacy alias; local Cargo installation has been removed.
build-cli-install: build-cli

# Build WASM packages (injector + engine)
build-wasm:
    bash src/server/injector/build-wasm.sh
    bash src/server/engine/build-wasm.sh

# Build fullstack fixtures for integration/e2e tests
build-fixtures:
    SEAM_PROFILE={{ _profile }} CRYPTO_FLAGS="{{ _crypto }}" {{ _cranelift }} bash scripts/build-fixtures.sh

# Run all tests (unit + integration + e2e)
test: test-unit test-integration test-e2e

# Run all unit tests (Rust + TS, parallel)
test-unit:
    #!/usr/bin/env bash
    set -uo pipefail
    pids=(); names=()
    just test-rs & pids+=($!); names+=(test-rs)
    just test-ts & pids+=($!); names+=(test-ts)
    failed=0
    for i in "${!pids[@]}"; do
      code=0; wait "${pids[$i]}" || code=$?
      if [ "$code" != "0" ]; then printf '==> %s FAILED (exit %s)\n' "${names[$i]}" "$code"; failed=1; fi
    done
    exit $failed

# Rust unit tests
test-rs:
    {{ _cranelift }} cargo test --workspace {{ _crypto }}

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
    SEAM_PROFILE={{ _profile }} bash scripts/test-integration.sh

# Playwright E2E tests (grouped parallel locally, serial in CI)
test-e2e:
    #!/usr/bin/env bash
    set -uo pipefail
    if [[ -n "${CI:-}" ]]; then
      cd tests/e2e && SEAM_PROFILE={{ _profile }} {{ pm }}x playwright test
      exit $?
    fi
    pids=(); names=()
    for group in core workspace feature misc; do
      names+=("$group")
      (cd tests/e2e && SEAM_PROFILE={{ _profile }} SEAM_E2E_GROUP="$group" {{ pm }}x playwright test) &
      pids+=($!)
    done
    failed=0
    for i in "${!pids[@]}"; do
      code=0; wait "${pids[$i]}" || code=$?
      if [ "$code" != "0" ]; then printf '==> e2e/%s FAILED (exit %s)\n' "${names[$i]}" "$code"; failed=1; fi
    done
    exit $failed

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
    {{ _cranelift }} cargo build -p seam-cli {{ _release }} {{ _crypto }}

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
