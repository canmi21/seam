#!/usr/bin/env bash
# Publish Rust crates and NPM packages for the SeamJS monorepo.
# Usage: bash scripts/publish.sh [--dry-run] [--skip-verify] [--rust-only] [--npm-only]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- Flags ---
DRY_RUN=false
SKIP_VERIFY=false
RUST_ONLY=false
NPM_ONLY=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)      DRY_RUN=true ;;
    --skip-verify)  SKIP_VERIFY=true ;;
    --rust-only)    RUST_ONLY=true ;;
    --npm-only)     NPM_ONLY=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

if $RUST_ONLY && $NPM_ONLY; then
  echo "Error: --rust-only and --npm-only are mutually exclusive"
  exit 1
fi

# --- Counters ---
PUBLISHED=0
SKIPPED=0
FAILED=0
FAILED_NAMES=()

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[info]${NC}  $*"; }
ok()    { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[skip]${NC}  $*"; }
fail()  { echo -e "${RED}[fail]${NC}  $*"; }

# --- 1. Pre-flight ---
info "Pre-flight checks..."

if [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  fail "Git working tree is dirty. Commit or stash changes first."
  exit 1
fi

VERSION=$(grep '^version' "$ROOT/Cargo.toml" | head -1 | sed 's/version = "\(.*\)"/\1/')
if [ -z "$VERSION" ]; then
  fail "Could not read version from Cargo.toml"
  exit 1
fi
info "Version: $VERSION"

for tool in cargo bun curl; do
  if ! command -v "$tool" &>/dev/null; then
    fail "Required tool not found: $tool"
    exit 1
  fi
done

if $DRY_RUN; then
  info "DRY RUN mode -- no packages will be published"
fi

# --- 2. Verify ---
if ! $SKIP_VERIFY; then
  info "Running verification (bun run verify)..."
  if ! (cd "$ROOT" && bun run verify); then
    fail "Verification failed. Fix issues or use --skip-verify to bypass."
    exit 1
  fi
  ok "Verification passed"
else
  warn "Verification skipped (--skip-verify)"
fi

# --- Helper: check if crate version exists on crates.io ---
crate_exists() {
  local name="$1" ver="$2"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "https://crates.io/api/v1/crates/$name/$ver")
  [ "$status" = "200" ]
}

# --- Helper: poll crates.io until version is indexed (1s interval, 60s timeout) ---
wait_for_crate() {
  local name="$1" ver="$2"
  local elapsed=0
  info "Waiting for $name@$ver to appear on crates.io..."
  while [ $elapsed -lt 60 ]; do
    sleep 1
    elapsed=$((elapsed + 1))
    if crate_exists "$name" "$ver"; then
      ok "$name@$ver indexed after ${elapsed}s"
      return 0
    fi
  done
  fail "$name@$ver not indexed after 60s"
  return 1
}

# --- Helper: check if npm package version exists ---
npm_pkg_exists() {
  local name="$1" ver="$2"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "https://registry.npmjs.org/$name/$ver")
  [ "$status" = "200" ]
}

# --- 3. Publish Rust crates ---
if ! $NPM_ONLY; then
  info "Publishing Rust crates (topological order)..."

  # Topological order: leaves first, dependents later
  RUST_CRATES=(
    "seam-injector"
    "seam-macros"
    "seam-engine"
    "seam-server"
    "seam-server-axum"
    "seam-injector-wasm"
    "seam-engine-wasm"
    "seam-cli"
  )

  for crate in "${RUST_CRATES[@]}"; do
    if crate_exists "$crate" "$VERSION"; then
      warn "$crate@$VERSION already on crates.io"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi

    info "Publishing $crate@$VERSION..."
    if $DRY_RUN; then
      if (cd "$ROOT" && cargo publish -p "$crate" --dry-run 2>&1); then
        ok "$crate (dry-run)"
        PUBLISHED=$((PUBLISHED + 1))
      else
        fail "$crate (dry-run failed)"
        FAILED=$((FAILED + 1))
        FAILED_NAMES+=("$crate")
        fail "Aborting remaining Rust crates (downstream would fail)"
        break
      fi
    else
      if (cd "$ROOT" && cargo publish -p "$crate"); then
        ok "$crate"
        PUBLISHED=$((PUBLISHED + 1))
        # Poll crates.io until indexed (skip after last crate)
        if [ "$crate" != "seam-cli" ]; then
          if ! wait_for_crate "$crate" "$VERSION"; then
            fail "Aborting: downstream crates need $crate indexed"
            break
          fi
        fi
      else
        fail "$crate"
        FAILED=$((FAILED + 1))
        FAILED_NAMES+=("$crate")
        fail "Aborting remaining Rust crates (downstream would fail)"
        break
      fi
    fi
  done
fi

# --- 4. Publish NPM packages ---
if ! $RUST_ONLY; then
  info "Publishing NPM packages..."

  # Check npm auth
  if ! $DRY_RUN; then
    if ! npm whoami &>/dev/null; then
      fail "Not authenticated with npm. Run 'npm login' first."
      exit 1
    fi
    ok "npm authenticated as $(npm whoami)"
  fi

  # Build TS packages
  info "Building TypeScript packages (bun run build:ts)..."
  if ! (cd "$ROOT" && bun run build:ts); then
    fail "TypeScript build failed"
    exit 1
  fi
  ok "TypeScript build complete"

  # Check WASM binaries for @canmi/seam-injector
  INJECTOR_PKG="$ROOT/packages/server/injector/js/pkg"
  if [ ! -d "$INJECTOR_PKG" ] || [ -z "$(ls -A "$INJECTOR_PKG" 2>/dev/null)" ]; then
    warn "@canmi/seam-injector: pkg/ missing or empty (WASM binaries required)"
    warn "Run 'bun run build:wasm' to generate them"
    INJECTOR_SKIP=true
  else
    INJECTOR_SKIP=false
  fi

  # Check WASM binaries for @canmi/seam-engine
  ENGINE_PKG="$ROOT/packages/server/engine/js/pkg"
  if [ ! -d "$ENGINE_PKG" ] || [ -z "$(ls -A "$ENGINE_PKG" 2>/dev/null)" ]; then
    warn "@canmi/seam-engine: pkg/ missing or empty (WASM binaries required)"
    warn "Run 'bash packages/server/engine/build-wasm.sh' to generate them"
    ENGINE_SKIP=true
  else
    ENGINE_SKIP=false
  fi

  # NPM packages in topological layers (excluding CLI wrapper packages)
  # Layer 1: leaf packages
  # Layer 2: depends on layer 1
  # Layer 3: depends on layer 2
  NPM_LAYER_1=(
    "packages/server/injector/native:@canmi/seam-injector-native"
    "packages/client/vanilla:@canmi/seam-client"
    "packages/eslint:@canmi/eslint-plugin-seam"
    "packages/i18n:@canmi/seam-i18n"
    "packages/server/injector/js:@canmi/seam-injector"
    "packages/server/engine/js:@canmi/seam-engine"
  )
  NPM_LAYER_2=(
    "packages/server/core/typescript:@canmi/seam-server"
    "packages/client/react:@canmi/seam-react"
  )
  NPM_LAYER_3=(
    "packages/server/adapter/hono:@canmi/seam-adapter-hono"
    "packages/server/adapter/bun:@canmi/seam-adapter-bun"
    "packages/server/adapter/node:@canmi/seam-adapter-node"
    "packages/client/tanstack-router:@canmi/seam-tanstack-router"
  )

  publish_npm_layer() {
    local layer_name="$1"
    shift
    local entries=("$@")

    info "--- $layer_name ---"
    for entry in "${entries[@]}"; do
      local dir="${entry%%:*}"
      local name="${entry##*:}"
      local pkg_dir="$ROOT/$dir"

      # Skip WASM-dependent packages if binaries missing
      if [ "$name" = "@canmi/seam-injector" ] && $INJECTOR_SKIP; then
        warn "$name (WASM pkg/ missing)"
        FAILED=$((FAILED + 1))
        FAILED_NAMES+=("$name")
        continue
      fi
      if [ "$name" = "@canmi/seam-engine" ] && $ENGINE_SKIP; then
        warn "$name (WASM pkg/ missing)"
        FAILED=$((FAILED + 1))
        FAILED_NAMES+=("$name")
        continue
      fi

      if npm_pkg_exists "$name" "$VERSION"; then
        warn "$name@$VERSION already on npm"
        SKIPPED=$((SKIPPED + 1))
        continue
      fi

      info "Publishing $name@$VERSION..."
      if $DRY_RUN; then
        if (cd "$pkg_dir" && npm publish --access public --dry-run 2>&1); then
          ok "$name (dry-run)"
          PUBLISHED=$((PUBLISHED + 1))
        else
          fail "$name (dry-run failed)"
          FAILED=$((FAILED + 1))
          FAILED_NAMES+=("$name")
        fi
      else
        if (cd "$pkg_dir" && npm publish --access public); then
          ok "$name"
          PUBLISHED=$((PUBLISHED + 1))
        else
          fail "$name"
          FAILED=$((FAILED + 1))
          FAILED_NAMES+=("$name")
        fi
      fi
    done
  }

  publish_npm_layer "Layer 1 (leaf)" "${NPM_LAYER_1[@]}"
  publish_npm_layer "Layer 2 (core)" "${NPM_LAYER_2[@]}"
  publish_npm_layer "Layer 3 (adapters)" "${NPM_LAYER_3[@]}"
fi

# --- 5. Summary ---
echo ""
echo "========================================"
echo "  Published: $PUBLISHED  |  Skipped: $SKIPPED  |  Failed: $FAILED"
echo "========================================"
if [ ${#FAILED_NAMES[@]} -gt 0 ]; then
  fail "Failed packages:"
  for name in "${FAILED_NAMES[@]}"; do
    echo "    - $name"
  done
  exit 1
fi
ok "All done."
