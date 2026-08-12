// ─── Git Hook Installation ───────────────────────────────────────────────────
// Installs a prepare-commit-msg hook into Braid-managed worktrees.
// The hook reads workspace metadata from .braid/workspace.local.md
// and appends Braid-Workspace and Braid-Project trailers to every commit.
// For multi-repo workspaces, it also copies workspace-level artifacts into the
// repo's .braid/<sanitizedName>/ directory so they get committed alongside code.
//
// The hook script is GENERIC — same content across all workspaces. All
// workspace-specific values come from workspace.local.md (gitignored).
// This means the hook itself is committable.

import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import simpleGit from 'simple-git'
import { deriveRepoBraidDir } from './derive-paths'

// ─── Hook script ────────────────────────────────────────────────────────────

function generatePrepareCommitMsgScript(originalRepoPath: string): string {
  const safeRepoPath = originalRepoPath.replace(/'/g, "'\\''")

  return `#!/bin/sh
# Braid prepare-commit-msg hook
# Reads workspace metadata from .braid/workspace.local.md.
# Appends Braid trailers + copies artifacts for multi-repo workspaces.
# This script is generic — safe to commit. Workspace-specific values
# come from workspace.local.md (gitignored).

COMMIT_MSG_FILE="$1"
COMMIT_SOURCE="$2"

# ── Chain with original hooks ──────────────────────────────────────────
HUSKY_HOOK='${safeRepoPath}/.husky/prepare-commit-msg'
if [ -x "$HUSKY_HOOK" ]; then
  "$HUSKY_HOOK" "$@"
  HUSKY_EXIT=$?
  if [ $HUSKY_EXIT -ne 0 ]; then exit $HUSKY_EXIT; fi
fi

REPO_HOOK='${safeRepoPath}/.git/hooks/prepare-commit-msg'
if [ -x "$REPO_HOOK" ]; then
  "$REPO_HOOK" "$@"
  REPO_EXIT=$?
  if [ $REPO_EXIT -ne 0 ]; then exit $REPO_EXIT; fi
fi

# ── Read workspace config ─────────────────────────────────────────────
# Look for config relative to the worktree root
WORKTREE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
CONFIG=""
# Multi-repo: config is one level up from worktree
if [ -f "$WORKTREE_ROOT/../.braid/workspace.local.md" ]; then
  CONFIG="$WORKTREE_ROOT/../.braid/workspace.local.md"
# Single-repo: config is inside .braid/
elif [ -f "$WORKTREE_ROOT/.braid/workspace.local.md" ]; then
  CONFIG="$WORKTREE_ROOT/.braid/workspace.local.md"
fi

if [ -z "$CONFIG" ]; then
  exit 0  # Not an active Braid workspace — skip silently
fi

WORKSPACE_NAME=$(grep 'workspace_name:' "$CONFIG" | sed 's/.*: *//' | tr -d '"' | tr -d "'")
PROJECT_NAME=$(grep 'project_name:' "$CONFIG" | sed 's/.*: *//' | tr -d '"' | tr -d "'")
IS_MULTI_REPO=$(grep 'is_multi_repo:' "$CONFIG" | sed 's/.*: *//')
ARTIFACT_DIR=$(grep 'artifact_dir:' "$CONFIG" | sed 's/.*: *//' | tr -d '"' | tr -d "'")

# ── Copy workspace artifacts into repo (multi-repo only) ──────────────
if [ "$IS_MULTI_REPO" = "true" ] && [ -d "$ARTIFACT_DIR" ]; then
  SANITIZED=$(echo "$WORKSPACE_NAME" | sed 's/[/\\\\]/-/g' | sed 's/\\.\\.//g')
  REPO_BRAID_DIR="$WORKTREE_ROOT/.braid/$SANITIZED"
  mkdir -p "$REPO_BRAID_DIR"
  for f in "$ARTIFACT_DIR"/*.yaml "$ARTIFACT_DIR"/*.yml; do
    [ -e "$f" ] && cp "$f" "$REPO_BRAID_DIR"/ 2>/dev/null || true
  done
  git add .braid/ 2>/dev/null || true
fi

# ── Skip for merge/squash commits ─────────────────────────────────────
if [ "$COMMIT_SOURCE" = "merge" ] || [ "$COMMIT_SOURCE" = "squash" ]; then
  exit 0
fi

# ── Append trailers (idempotent) ───────────────────────────────────────
if grep -q "^Braid-Workspace:" "$COMMIT_MSG_FILE" 2>/dev/null; then
  exit 0
fi

printf '\\n\\nBraid-Workspace: %s\\nBraid-Project: %s\\n' "$WORKSPACE_NAME" "$PROJECT_NAME" >> "$COMMIT_MSG_FILE"
`
}

// ─── Installation ────────────────────────────────────────────────────────────

/**
 * Install the prepare-commit-msg hook into a worktree.
 * The hook is generic — reads from workspace.local.md at runtime.
 */
export async function installWorktreeHooks(
  worktreePath: string,
  repoPath: string,
): Promise<void> {
  const hooksDir = join(deriveRepoBraidDir(worktreePath), 'hooks')
  if (!existsSync(hooksDir)) {
    mkdirSync(hooksDir, { recursive: true })
  }

  const hookPath = join(hooksDir, 'prepare-commit-msg')
  const script = generatePrepareCommitMsgScript(repoPath)
  writeFileSync(hookPath, script, 'utf-8')
  chmodSync(hookPath, 0o755)

  const git = simpleGit(worktreePath)
  await git.addConfig('core.hooksPath', hooksDir)

  console.log(`[git-hooks] installed prepare-commit-msg hook: ${hookPath}`)
}
