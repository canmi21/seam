#!/usr/bin/env bash
# Push commits and local-only tags to the remote.
# Usage: bash scripts/push.sh
set -euo pipefail

# Push unpushed commits
BRANCH=$(git rev-parse --abbrev-ref HEAD)
BEHIND_AHEAD=$(git rev-list --left-right --count "origin/$BRANCH...$BRANCH" 2>/dev/null || echo "0 0")
AHEAD=$(echo "$BEHIND_AHEAD" | awk '{print $2}')

if [ "$AHEAD" -gt 0 ]; then
  echo "Pushing $AHEAD commit(s) to origin/$BRANCH..."
  git push
else
  echo "No unpushed commits."
fi

# Find local-only tags (not on remote)
LOCAL_TAGS=$(git tag -l)
REMOTE_TAGS=$(git ls-remote --tags origin 2>/dev/null | awk '{print $2}' | sed 's|refs/tags/||')
NEW_TAGS=()
for tag in $LOCAL_TAGS; do
  if ! echo "$REMOTE_TAGS" | grep -qx "$tag"; then
    NEW_TAGS+=("$tag")
  fi
done

if [ ${#NEW_TAGS[@]} -gt 0 ]; then
  echo "Pushing ${#NEW_TAGS[@]} new tag(s):"
  for tag in "${NEW_TAGS[@]}"; do echo "  $tag"; done
  git push --tags
else
  echo "No new tags to push."
fi
