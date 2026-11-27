#!/usr/bin/env bash
# scripts/autofix/run-autofix.sh
# Best-effort local auto-fix for common lint issues.
# Only fixes files with uncommitted changes (staged + unstaged), never the whole tree.
# Exit 0 always — auto-fix is advisory, it must never block a commit by itself.

set -euo pipefail

CHANGED="$(git diff --name-only HEAD --diff-filter=ACMR 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|mjs|cjs)$' || true)"
[ -z "$CHANGED" ] && { echo "Auto-fix: no changed JS/TS files."; exit 0; }

FIXED_ANY=0
echo "Auto-fix: applying eslint --fix to $(echo "$CHANGED" | wc -l) changed file(s)..."
if command -v bunx >/dev/null 2>&1; then
  # eslint --fix scoped to changed files
  if bunx eslint --fix $CHANGED 2>/dev/null; then
    FIXED_ANY=1
  fi
fi

# Report what changed so the caller can re-stage
STILL_DIRTY="$(git diff --name-only --diff-filter=ACMR 2>/dev/null | grep -E '\.(ts|tsx|js|jsx|mjs|cjs)$' || true)"
if [ "$FIXED_ANY" = "1" ]; then
  echo "Auto-fix complete. Re-run 'git add' if fixes touched staged files:"
  git diff --name-only --diff-filter=ACMR | head -20
fi

exit 0
