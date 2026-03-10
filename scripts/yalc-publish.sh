#!/usr/bin/env bash
# scripts/yalc-publish.sh
# Publish all TS packages plus the local CLI wrapper to yalc.
# Usage: bash scripts/yalc-publish.sh [--push]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUSH=false
[[ "${1:-}" == "--push" ]] && PUSH=true

if [[ -n "${CI:-}" ]]; then
  printf '==> skip yalc in CI\n'
  exit 0
fi

host_cli_wrapper() {
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) echo "aarch64-apple-darwin:src/cli/wrapper/darwin-arm64" ;;
    Darwin-x86_64) echo "x86_64-apple-darwin:src/cli/wrapper/darwin-x64" ;;
    Linux-aarch64) echo "aarch64-unknown-linux-musl:src/cli/wrapper/linux-arm64" ;;
    Linux-x86_64) echo "x86_64-unknown-linux-musl:src/cli/wrapper/linux-x64" ;;
    *)
      echo "Unsupported host platform: $(uname -s)-$(uname -m)" >&2
      exit 1
      ;;
  esac
}

HOST_CLI_TARGET="${HOST_CLI_TARGET:-}"
HOST_CLI_WRAPPER="${HOST_CLI_WRAPPER:-}"

if [[ -z "$HOST_CLI_TARGET" || -z "$HOST_CLI_WRAPPER" ]]; then
  IFS=: read -r HOST_CLI_TARGET HOST_CLI_WRAPPER <<<"$(host_cli_wrapper)"
fi

printf '==> build local CLI wrapper (%s -> %s)\n' "$HOST_CLI_TARGET" "$HOST_CLI_WRAPPER"
bash "$ROOT/scripts/build-cli.sh" --target "$HOST_CLI_TARGET"

PACKAGES=(
  src/cli/wrapper/darwin-arm64
  src/cli/wrapper/darwin-x64
  src/cli/wrapper/linux-arm64
  src/cli/wrapper/linux-x64
  src/cli/seam
  src/server/engine/js
  src/client/vanilla
  src/cli/vite
  src/i18n
  src/router/seam
  src/query/seam
  src/eslint
  src/server/core/typescript
  src/client/react
  src/query/react
  src/server/adapter/hono
  src/server/adapter/bun
  src/server/adapter/node
  src/router/tanstack
  src/cli/pkg
)

CMD="yalc publish"
$PUSH && CMD="yalc push"

printf '==> yalc %s (%d packages)\n' "$($PUSH && echo push || echo publish)" "${#PACKAGES[@]}"

for pkg in "${PACKAGES[@]}"; do
  name=$(jq -r .name "$pkg/package.json")
  printf '  %s (%s)\n' "$name" "$pkg"
  (cd "$pkg" && $CMD --no-scripts)
done

printf '==> Done.\n'
