#!/usr/bin/env bash
# Publish Rust crates, NPM packages, and Go modules for the SeamJS monorepo.
# Selective publishing: only packages with real changes since the previous version tag.
# Usage: bash scripts/publish.sh [--dry-run] [--skip-verify] [--skip-dirty] [--rust-only] [--npm-only] [--go-only] [--all]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# --- Flags ---
DRY_RUN=false
SKIP_VERIFY=false
SKIP_DIRTY=false
RUST_ONLY=false
NPM_ONLY=false
GO_ONLY=false
FORCE_ALL=false

for arg in "$@"; do
  case "$arg" in
    --dry-run)      DRY_RUN=true ;;
    --skip-verify)  SKIP_VERIFY=true ;;
    --skip-dirty)   SKIP_DIRTY=true ;;
    --rust-only)    RUST_ONLY=true ;;
    --npm-only)     NPM_ONLY=true ;;
    --go-only)      GO_ONLY=true ;;
    --all)          FORCE_ALL=true ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# Mutual exclusion: only one of --rust-only, --npm-only, --go-only
exclusive_count=0
$RUST_ONLY && exclusive_count=$((exclusive_count + 1))
$NPM_ONLY  && exclusive_count=$((exclusive_count + 1))
$GO_ONLY   && exclusive_count=$((exclusive_count + 1))
if [ "$exclusive_count" -gt 1 ]; then
  echo "Error: --rust-only, --npm-only, and --go-only are mutually exclusive"
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

if ! $SKIP_DIRTY && [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  fail "Git working tree is dirty. Commit or stash changes first."
  exit 1
fi

VERSION=$(grep '^version' "$ROOT/Cargo.toml" | head -1 | sed 's/version = "\(.*\)"/\1/')
if [ -z "$VERSION" ]; then
  fail "Could not read version from Cargo.toml"
  exit 1
fi
info "Version: $VERSION"

for tool in cargo bun curl jq; do
  if ! command -v "$tool" &>/dev/null; then
    fail "Required tool not found: $tool"
    exit 1
  fi
done

if $DRY_RUN; then
  info "DRY RUN mode -- no packages will be published"
fi

# --- Change detection baseline ---
CURRENT_TAG="v$VERSION"
PREV_TAG=$(git tag --sort=-v:refname | grep '^v[0-9]' | grep -v "^${CURRENT_TAG}$" | head -1 || true)

if [ -z "$PREV_TAG" ]; then
  if ! $FORCE_ALL; then
    fail "No previous version tag found. Use --all for first publish."
    exit 1
  fi
  info "No previous tag found, --all mode: publishing everything"
else
  info "Change baseline: $PREV_TAG -> $CURRENT_TAG"
fi

# --- Helper: detect real changes (not just version bumps) ---
has_real_changes() {
  local dir="$1"
  if [ -z "$PREV_TAG" ]; then return 0; fi

  local changed_files
  changed_files=$(git diff --name-only "$PREV_TAG"..HEAD -- "$dir" 2>/dev/null)
  [ -z "$changed_files" ] && return 1

  while IFS= read -r f; do
    case "$f" in *.lock|Cargo.lock) continue ;; esac
    case "$f" in
      */package.json|*/Cargo.toml)
        local real_diff
        real_diff=$(git diff "$PREV_TAG"..HEAD -- "$f" \
          | grep '^[+-]' | grep -v '^[+-][+-][+-]' \
          | grep -v -E '"version"|version = "' || true)
        [ -n "$real_diff" ] && return 0
        ;;
      *)
        return 0
        ;;
    esac
  done <<< "$changed_files"
  return 1
}

# --- Helper: WASM chain detection ---
wasm_chain_changed() {
  has_real_changes "src/server/engine/rust" ||
  has_real_changes "src/server/engine/wasm" ||
  has_real_changes "src/server/injector/rust"
}

# --- Helper: CLI chain detection ---
cli_chain_changed() {
  has_real_changes "src/cli/skeleton" ||
  has_real_changes "src/cli/codegen" ||
  has_real_changes "src/cli/core" ||
  has_real_changes "src/cli/pkg"
}

# --- Helper: crate name to directory ---
crate_dir() {
  case "$1" in
    seam-injector)    echo "src/server/injector/rust" ;;
    seam-macros)      echo "src/server/core/rust-macros" ;;
    seam-engine)      echo "src/server/engine/rust" ;;
    seam-server)      echo "src/server/core/rust" ;;
    seam-server-axum) echo "src/server/adapter/axum" ;;
    seam-engine-wasm) echo "src/server/engine/wasm" ;;
    seam-skeleton)    echo "src/cli/skeleton" ;;
    seam-codegen)     echo "src/cli/codegen" ;;
    seam-cli)         echo "src/cli/core" ;;
  esac
}

# --- Skipped crate tracking (parallel arrays: name -> registry latest version) ---
SKIPPED_CRATE_NAMES=()
SKIPPED_CRATE_VERS=()

# --- Helper: query latest version of a crate on crates.io ---
crate_latest_version() {
  local name="$1"
  curl -s "https://crates.io/api/v1/crates/$name" | jq -r '.crate.max_version'
}

# --- Helper: look up registry version for a skipped crate ---
skipped_ver_for() {
  local name="$1" i
  for i in "${!SKIPPED_CRATE_NAMES[@]}"; do
    if [ "${SKIPPED_CRATE_NAMES[$i]}" = "$name" ]; then
      echo "${SKIPPED_CRATE_VERS[$i]}"
      return 0
    fi
  done
  return 1
}

# --- Helper: patch Cargo.toml to use registry versions for skipped deps ---
# For each internal dependency that was skipped, replace its version with
# the latest version available on crates.io so cargo publish can resolve it.
patch_skipped_deps() {
  local crate_dir="$1"
  local cargo_toml="$ROOT/$crate_dir/Cargo.toml"
  local needs_patch=false

  for dep in "${SKIPPED_CRATE_NAMES[@]}"; do
    if grep -q "^$dep = " "$cargo_toml"; then
      needs_patch=true
      break
    fi
  done

  if ! $needs_patch; then return; fi

  cp "$cargo_toml" "$cargo_toml.pub-bak"
  for dep in "${SKIPPED_CRATE_NAMES[@]}"; do
    if grep -q "^$dep = " "$cargo_toml"; then
      local reg_ver
      reg_ver=$(skipped_ver_for "$dep")
      sed -i '' "s/$dep = { version = \"$VERSION\"/$dep = { version = \"$reg_ver\"/" "$cargo_toml"
      info "  patched $dep dependency: $VERSION -> $reg_ver"
    fi
  done
}

restore_cargo_toml() {
  local crate_dir="$1"
  local cargo_toml="$ROOT/$crate_dir/Cargo.toml"
  if [ -f "$cargo_toml.pub-bak" ]; then
    mv "$cargo_toml.pub-bak" "$cargo_toml"
  fi
}

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

# --- Helper: resolve workspace:* to real version in package.json ---
# Replaces "workspace:*" and "workspace:^" with the current VERSION.
# Saves a backup as package.json.bak for restoration after publish.
resolve_workspace_versions() {
  local pkg_json="$1/package.json"
  cp "$pkg_json" "$pkg_json.bak"
  sed -i '' "s/\"workspace:\*\"/\"$VERSION\"/g; s/\"workspace:\\^\"/\"^$VERSION\"/g" "$pkg_json"
}

restore_package_json() {
  local pkg_json="$1/package.json"
  if [ -f "$pkg_json.bak" ]; then
    mv "$pkg_json.bak" "$pkg_json"
  fi
}

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

# --- 3. Publish Rust crates ---
if ! $NPM_ONLY && ! $GO_ONLY; then
  info "Publishing Rust crates (topological order)..."

  RUST_CRATES=(
    "seam-injector"
    "seam-macros"
    "seam-engine"
    "seam-server"
    "seam-server-axum"
    "seam-engine-wasm"
    "seam-skeleton"
    "seam-codegen"
    "seam-cli"
  )

  for crate in "${RUST_CRATES[@]}"; do
    if crate_exists "$crate" "$VERSION"; then
      warn "$crate@$VERSION already on crates.io"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi

    if ! $FORCE_ALL && ! has_real_changes "$(crate_dir "$crate")"; then
      reg_ver=$(crate_latest_version "$crate")
      SKIPPED_CRATE_NAMES+=("$crate")
      SKIPPED_CRATE_VERS+=("$reg_ver")
      info "$crate: no changes, skipping (registry: $reg_ver)"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi

    dir=$(crate_dir "$crate")
    patch_skipped_deps "$dir"

    info "Publishing $crate@$VERSION..."
    if $DRY_RUN; then
      if (cd "$ROOT" && cargo publish -p "$crate" --allow-dirty --dry-run 2>&1); then
        ok "$crate (dry-run)"
        PUBLISHED=$((PUBLISHED + 1))
      else
        fail "$crate (dry-run failed)"
        FAILED=$((FAILED + 1))
        FAILED_NAMES+=("$crate")
        restore_cargo_toml "$dir"
        fail "Aborting remaining Rust crates (downstream would fail)"
        break
      fi
    else
      if (cd "$ROOT" && cargo publish -p "$crate" --allow-dirty); then
        ok "$crate"
        PUBLISHED=$((PUBLISHED + 1))
        if [ "$crate" != "seam-cli" ]; then
          if ! wait_for_crate "$crate" "$VERSION"; then
            restore_cargo_toml "$dir"
            fail "Aborting: downstream crates need $crate indexed"
            break
          fi
        fi
      else
        fail "$crate"
        FAILED=$((FAILED + 1))
        FAILED_NAMES+=("$crate")
        restore_cargo_toml "$dir"
        fail "Aborting remaining Rust crates (downstream would fail)"
        break
      fi
    fi
    restore_cargo_toml "$dir"
  done
fi

# --- 4. Publish NPM packages ---
if ! $RUST_ONLY && ! $GO_ONLY; then
  info "Publishing NPM packages..."

  if ! $DRY_RUN; then
    if ! npm whoami &>/dev/null; then
      fail "Not authenticated with npm. Run 'npm login' first."
      exit 1
    fi
    ok "npm authenticated as $(npm whoami)"
  fi

  info "Building TypeScript packages (bun run build:ts)..."
  if ! (cd "$ROOT" && bun run build:ts); then
    fail "TypeScript build failed"
    exit 1
  fi
  ok "TypeScript build complete"

  # Build CLI binaries for all platforms (only when CLI source changed)
  if $FORCE_ALL || cli_chain_changed; then
    info "Building CLI binaries (bash scripts/build-cli.sh)..."
    if ! bash "$ROOT/scripts/build-cli.sh"; then
      fail "CLI binary build failed"
      exit 1
    fi
    ok "CLI binaries built"
  fi

  ENGINE_PKG="$ROOT/src/server/engine/js/pkg"
  if [ ! -d "$ENGINE_PKG" ] || [ -z "$(ls -A "$ENGINE_PKG" 2>/dev/null)" ]; then
    warn "@canmi/seam-engine: pkg/ missing or empty (WASM binaries required)"
    warn "Run 'bash src/server/engine/build-wasm.sh' to generate them"
    ENGINE_SKIP=true
  else
    ENGINE_SKIP=false
  fi

  NPM_LAYER_0=(
    "src/cli/wrapper/darwin-arm64:@canmi/seam-cli-darwin-arm64"
    "src/cli/wrapper/darwin-x64:@canmi/seam-cli-darwin-x64"
    "src/cli/wrapper/linux-arm64:@canmi/seam-cli-linux-arm64"
    "src/cli/wrapper/linux-x64:@canmi/seam-cli-linux-x64"
  )
  NPM_LAYER_1=(
    "src/client/vanilla:@canmi/seam-client"
    "src/eslint:@canmi/eslint-plugin-seam"
    "src/i18n:@canmi/seam-i18n"
    "src/server/engine/js:@canmi/seam-engine"
  )
  NPM_LAYER_2=(
    "src/server/core/typescript:@canmi/seam-server"
    "src/client/react:@canmi/seam-react"
  )
  NPM_LAYER_3=(
    "src/server/adapter/hono:@canmi/seam-adapter-hono"
    "src/server/adapter/bun:@canmi/seam-adapter-bun"
    "src/server/adapter/node:@canmi/seam-adapter-node"
    "src/client/tanstack-router:@canmi/seam-tanstack-router"
  )
  NPM_LAYER_4=(
    "src/cli/pkg:@canmi/seam-cli"
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

      # Selective publishing: check for real changes
      if ! $FORCE_ALL; then
        local should_publish=false
        if [ "$name" = "@canmi/seam-engine" ] && wasm_chain_changed; then
          should_publish=true
        elif [[ "$name" == @canmi/seam-cli* ]] && cli_chain_changed; then
          should_publish=true
        elif has_real_changes "$dir"; then
          should_publish=true
        fi
        if ! $should_publish; then
          info "$name: no changes, skipping"
          SKIPPED=$((SKIPPED + 1))
          continue
        fi
      fi

      info "Publishing $name@$VERSION..."
      resolve_workspace_versions "$pkg_dir"
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
      restore_package_json "$pkg_dir"
    done
  }

  publish_npm_layer "Layer 0 (CLI wrappers)" "${NPM_LAYER_0[@]}"
  publish_npm_layer "Layer 1 (leaf)" "${NPM_LAYER_1[@]}"
  publish_npm_layer "Layer 2 (core)" "${NPM_LAYER_2[@]}"
  publish_npm_layer "Layer 3 (adapters)" "${NPM_LAYER_3[@]}"
  publish_npm_layer "Layer 4 (CLI)" "${NPM_LAYER_4[@]}"
fi

# --- 5. Publish Go modules (git tags) ---
if ! $RUST_ONLY && ! $NPM_ONLY; then
  info "Publishing Go modules (git tags)..."

  GO_MODULES=(
    "src/server/core/go"
    "src/server/engine/go"
    "src/server/injector/go"
  )

  for mod_dir in "${GO_MODULES[@]}"; do
    tag="${mod_dir}/v${VERSION}"

    if git rev-parse "$tag" >/dev/null 2>&1; then
      warn "Go tag $tag already exists"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi

    # WASM chain: Go engine/injector embed .wasm built from Rust
    needs_publish=false
    if $FORCE_ALL; then
      needs_publish=true
    elif has_real_changes "$mod_dir"; then
      needs_publish=true
    elif [ "$mod_dir" = "src/server/engine/go" ] || [ "$mod_dir" = "src/server/injector/go" ]; then
      wasm_chain_changed && needs_publish=true
    fi

    if ! $needs_publish; then
      info "$mod_dir: no changes, skipping"
      SKIPPED=$((SKIPPED + 1))
      continue
    fi

    info "Tagging $tag..."
    if $DRY_RUN; then
      ok "$tag (dry-run)"
    else
      git tag "$tag"
      ok "$tag"
    fi
    PUBLISHED=$((PUBLISHED + 1))
  done

  if ! $DRY_RUN; then
    info "Push Go tags with: bash scripts/push.sh"
  fi
fi

# --- 6. Summary ---
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
