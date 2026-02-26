#!/usr/bin/env bash
# scripts/build-wasm.sh
# Shared WASM build script for all seam WASM crates.
#
# Usage: bash scripts/build-wasm.sh <package-dir> <short-name>
#   package-dir  Root of the package (e.g. packages/server/injector)
#   short-name   Output file prefix (e.g. injector, engine)
#
# Expects the package to have:
#   <package-dir>/wasm/        Rust crate with wasm-pack compatible Cargo.toml
#   <package-dir>/js/pkg/      JS package output directory (created if missing)
#   <package-dir>/go/          Go package directory for the WASM binary
set -euo pipefail

PKG_DIR="$1"
NAME="$2"

if [[ -z "$PKG_DIR" || -z "$NAME" ]]; then
  echo "Usage: bash scripts/build-wasm.sh <package-dir> <short-name>"
  exit 1
fi

# Resolve to absolute paths before cd changes the working directory
PKG_DIR="$(cd "$PKG_DIR" && pwd)"

# Derive the wasm-pack crate name from Cargo.toml
CRATE_NAME=$(grep '^name' "$PKG_DIR/wasm/Cargo.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/' | tr '-' '_')
JS_PKG="$PKG_DIR/js/pkg"

echo "Building $CRATE_NAME..."
cd "$PKG_DIR/wasm"
wasm-pack build --target bundler --out-dir pkg

echo "Distributing WASM artifacts as '$NAME'..."
rm -rf "$JS_PKG"
mkdir -p "$JS_PKG"

# Core artifacts: .wasm binary, glue JS, WASM module types
cp "pkg/${CRATE_NAME}_bg.wasm"     "$JS_PKG/$NAME.wasm"
cp "pkg/${CRATE_NAME}_bg.js"       "$JS_PKG/$NAME.js"
cp "pkg/${CRATE_NAME}_bg.wasm.d.ts" "$JS_PKG/$NAME.wasm.d.ts"

# bridge.js: bundler entry point (fix internal refs to renamed files)
cp "pkg/${CRATE_NAME}.js" "$JS_PKG/bridge.js"
# sed -i behaves differently on macOS (BSD) vs Linux (GNU):
# macOS requires -i '', GNU requires -i without argument.
if [[ "$OSTYPE" == darwin* ]]; then
  sed -i '' "s|${CRATE_NAME}_bg\\.wasm|$NAME.wasm|g; s|${CRATE_NAME}_bg\\.js|$NAME.js|g" "$JS_PKG/bridge.js"
else
  sed -i "s|${CRATE_NAME}_bg\\.wasm|$NAME.wasm|g; s|${CRATE_NAME}_bg\\.js|$NAME.js|g" "$JS_PKG/bridge.js"
fi

# bridge.d.ts: types for bundler entry
cp "pkg/${CRATE_NAME}.d.ts" "$JS_PKG/bridge.d.ts"

# <name>.d.ts: types for glue code (entry types + __wbg helpers)
cp "pkg/${CRATE_NAME}.d.ts" "$JS_PKG/$NAME.d.ts"
echo 'export function __wbindgen_init_externref_table(): void;' >> "$JS_PKG/$NAME.d.ts"
echo 'export function __wbg_set_wasm(val: WebAssembly.Exports): void;' >> "$JS_PKG/$NAME.d.ts"

# Go package: copy WASM binary
cp "pkg/${CRATE_NAME}_bg.wasm" "$PKG_DIR/go/$NAME.wasm"

echo "Done: $NAME"
