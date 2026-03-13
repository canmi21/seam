#!/usr/bin/env bash
# scripts/typecheck-ts.sh
# Run tsc --noEmit for all TypeScript packages in parallel.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

packages=(
  src/server/engine/js
  src/server/injector/js
  src/server/injector/native
  src/server/core/typescript
  src/server/adapter/hono
  src/server/adapter/bun
  src/server/adapter/node
  src/client/vanilla
  src/client/react
  src/router/tanstack
  src/router/seam
  src/cli/vite
  src/eslint
  src/i18n
  src/query/seam
  src/query/react
)

printf '\n==> Type check (tsc --noEmit) — %d packages in parallel\n' "${#packages[@]}"

pids=()
for pkg in "${packages[@]}"; do
  (cd "$ROOT" && bunx tsc --noEmit -p "$pkg/tsconfig.json") &
  pids+=($!)
done

failed=()
for i in "${!packages[@]}"; do
  code=0; wait "${pids[$i]}" || code=$?
  if [ "$code" != "0" ]; then
    printf '  %s ... FAIL\n' "${packages[$i]}"
    failed+=("${packages[$i]}")
  else
    printf '  %s ... ok\n' "${packages[$i]}"
  fi
done

if [[ ${#failed[@]} -gt 0 ]]; then
  printf '\n==> Type check FAILED in:\n'
  for pkg in "${failed[@]}"; do
    printf '  - %s\n' "$pkg"
  done
  exit 1
fi

printf '==> Type check passed.\n'
