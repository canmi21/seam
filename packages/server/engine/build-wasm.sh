#!/usr/bin/env bash
# packages/server/engine/build-wasm.sh
# Build WASM and distribute to JS and Go packages.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building seam-engine-wasm..."
cd "$SCRIPT_DIR/wasm"
wasm-pack build --target bundler --out-dir pkg

echo "Generating _bg.d.ts for JS bridge..."
# Extract function signatures from main .d.ts and add wasm-bindgen internals
{
  echo '/* tslint:disable */'
  echo '/* eslint-disable */'
  grep '^export function ' pkg/seam_engine_wasm.d.ts
  echo 'export function __wbindgen_init_externref_table(): void;'
  echo 'export function __wbg_set_wasm(val: WebAssembly.Exports): void;'
} > pkg/seam_engine_wasm_bg.d.ts

echo "Copying WASM to JS package..."
mkdir -p "$SCRIPT_DIR/js/pkg"
cp pkg/seam_engine_wasm_bg.wasm "$SCRIPT_DIR/js/pkg/"
cp pkg/seam_engine_wasm_bg.js "$SCRIPT_DIR/js/pkg/"
cp pkg/seam_engine_wasm_bg.d.ts "$SCRIPT_DIR/js/pkg/"
cp pkg/seam_engine_wasm.js "$SCRIPT_DIR/js/pkg/"
cp pkg/seam_engine_wasm.d.ts "$SCRIPT_DIR/js/pkg/"
cp pkg/seam_engine_wasm_bg.wasm.d.ts "$SCRIPT_DIR/js/pkg/"

echo "Copying WASM to Go package..."
cp pkg/seam_engine_wasm_bg.wasm "$SCRIPT_DIR/go/seam_engine_wasm.wasm"

echo "Done."
