#!/usr/bin/env bash
# Run tsc --noEmit for every TS package. Collects all failures and reports at the end.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

packages=(
  packages/server/injector/js
  packages/server/injector/native
  packages/server/core/typescript
  packages/server/adapter/hono
  packages/server/adapter/bun
  packages/server/adapter/node
  packages/client/vanilla
  packages/client/react
  packages/client/tanstack-router
  packages/eslint
  packages/i18n
)

failed=()

printf '\n==> Type check (tsc --noEmit)\n'

for pkg in "${packages[@]}"; do
  printf '  %s ... ' "$pkg"
  if (cd "$ROOT" && pnpm exec tsc --noEmit -p "$pkg/tsconfig.json") 2>&1; then
    printf 'ok\n'
  else
    printf 'FAIL\n'
    failed+=("$pkg")
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
