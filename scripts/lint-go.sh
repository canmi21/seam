#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
status=0

while IFS= read -r mod; do
  dir="$(dirname "$mod")"
  rel="${dir#"$ROOT"/}"
  printf '  -> %s\n' "$rel"
  (cd "$dir" && golangci-lint run ./...) || status=1
done < <(find "$ROOT" -name go.mod -not -path '*/vendor/*')

exit $status
