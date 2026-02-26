#!/usr/bin/env bash
# packages/server/engine/build-wasm.sh
# Build WASM and distribute to JS and Go packages.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building seam-engine-wasm..."
cd "$SCRIPT_DIR/wasm"
wasm-pack build --target bundler --out-dir pkg

echo "Copying WASM to JS package..."
mkdir -p "$SCRIPT_DIR/js/pkg"
cp pkg/seam_engine_wasm_bg.wasm "$SCRIPT_DIR/js/pkg/engine.wasm"
cp pkg/seam_engine_wasm_bg.js "$SCRIPT_DIR/js/pkg/"
cp pkg/seam_engine_wasm.js "$SCRIPT_DIR/js/pkg/"
cp pkg/seam_engine_wasm.d.ts "$SCRIPT_DIR/js/pkg/"
cp pkg/seam_engine_wasm_bg.wasm.d.ts "$SCRIPT_DIR/js/pkg/engine.wasm.d.ts"
# seam_engine_wasm_bg.d.ts is manually maintained in js/pkg/
# Fix bundler entry point to reference renamed .wasm
sed -i '' 's|seam_engine_wasm_bg\.wasm|engine.wasm|g' "$SCRIPT_DIR/js/pkg/seam_engine_wasm.js"

echo "Copying WASM to Go package..."
cp pkg/seam_engine_wasm_bg.wasm "$SCRIPT_DIR/go/engine.wasm"

echo "Done."
