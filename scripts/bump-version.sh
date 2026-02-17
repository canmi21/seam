#!/usr/bin/env bash
# Sync version from Cargo.toml workspace to all package.json files.
# Usage: bash scripts/bump-version.sh [version]
#   If version arg is omitted, reads from Cargo.toml workspace.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ $# -ge 1 ]; then
  VERSION="$1"
  # Also update Cargo.toml
  sed -i '' "s/^version = \".*\"/version = \"$VERSION\"/" "$ROOT/Cargo.toml"
  echo "Set Cargo.toml workspace version to $VERSION"
else
  VERSION=$(grep '^version' "$ROOT/Cargo.toml" | head -1 | sed 's/version = "\(.*\)"/\1/')
fi

echo "Syncing version $VERSION to all package.json files..."

count=0
while IFS= read -r pkg; do
  # Replace the top-level "version" field
  sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"$VERSION\"/" "$pkg"
  count=$((count + 1))
  echo "  ${pkg#$ROOT/}"
done < <(find "$ROOT/packages" -name "package.json" -not -path "*/node_modules/*" | sort)

echo "Done: $count package.json files updated to $VERSION"
