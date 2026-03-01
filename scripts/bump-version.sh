#!/usr/bin/env bash
# Sync version from Cargo.toml workspace to all package.json and Cargo.toml files.
# Usage: bash scripts/bump-version.sh [version]
#   If version arg is omitted, reads from Cargo.toml workspace.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ $# -ge 1 ]; then
  VERSION="$1"
  sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" "$ROOT/Cargo.toml"
  echo "Set Cargo.toml workspace version to $VERSION"
else
  VERSION=$(grep '^version' "$ROOT/Cargo.toml" | head -1 | sed 's/version = "\(.*\)"/\1/')
fi

echo "Syncing version $VERSION..."

# Deprecated packages: version frozen, skip updates
SKIP_DIRS=(
  "src/server/injector/native"
  "src/server/injector/js"
  "src/server/injector/wasm/pkg"
)

skip_pkg() {
  local p="$1"
  for d in "${SKIP_DIRS[@]}"; do
    if [[ "$p" == *"$d"* ]]; then return 0; fi
  done
  return 1
}

# 1. Update "version" field in all package.json under src/
count=0
while IFS= read -r pkg; do
  if skip_pkg "$pkg"; then
    echo "  ${pkg#$ROOT/} (skipped, deprecated)"
    continue
  fi
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$pkg"
  count=$((count + 1))
  echo "  ${pkg#$ROOT/}"
done < <(find "$ROOT/src" -name "package.json" -not -path "*/node_modules/*" | sort)
echo "Updated $count package.json files"

# 2. Update internal @canmi/* version references in optionalDependencies
echo "Updating internal dependency version references..."
while IFS= read -r pkg; do
  if grep -q '"@canmi/seam-cli-' "$pkg"; then
    sed -i '' "s/\"@canmi\/seam-cli-\([^\"]*\)\": \"[^\"]*\"/\"@canmi\/seam-cli-\1\": \"$VERSION\"/g" "$pkg"
    echo "  ${pkg#$ROOT/} (optionalDependencies)"
  fi
done < <(find "$ROOT/src" -name "package.json" -not -path "*/node_modules/*" | sort)

# 3. Update version in Cargo.toml internal path dependencies
#    Handles both formats:
#      a) version + path:  { version = "...", path = "..." }
#      b) path-only:       { path = "..." }  -> adds version field
INTERNAL_CRATES="seam-injector\|seam-macros\|seam-engine\|seam-server\|seam-server-axum\|seam-engine-wasm\|seam-skeleton\|seam-codegen"
echo "Updating Rust path dependency versions..."
while IFS= read -r cargo; do
  changed=false
  # 3a. Update existing version+path entries
  if grep -q 'version = ".*", path = "' "$cargo"; then
    sed -i '' 's/version = "[^"]*", path = "/version = "'"$VERSION"'", path = "/g' "$cargo"
    changed=true
  fi
  # 3b. Add version to path-only entries for known internal crates
  if grep -qE "^(${INTERNAL_CRATES//\\|/|}) = \{ path = " "$cargo"; then
    sed -i '' '/^\('"$INTERNAL_CRATES"'\) = { path = /s/{ path = /{ version = "'"$VERSION"'", path = /g' "$cargo"
    changed=true
  fi
  if $changed; then
    echo "  ${cargo#$ROOT/}"
  fi
done < <(find "$ROOT/src" "$ROOT/examples" -name "Cargo.toml" | sort)

# 4. Regenerate lockfile to reflect version changes
echo "Regenerating bun.lock..."
cd "$ROOT" && bun install

# 5. Format and lint
echo "Running format and lint..."
cd "$ROOT" && bun fmt && bun lint

# 6. Create version tag as baseline for selective publishing
TAG="v$VERSION"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Tag $TAG already exists, updating..."
  git tag -f "$TAG"
else
  git tag "$TAG"
fi
echo "Tagged $TAG (local baseline for publish.sh)"

echo "Done: all versions synced to $VERSION"
