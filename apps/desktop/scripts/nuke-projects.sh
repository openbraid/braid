#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# nuke-projects.sh
#
# Wipes all projects (and their workspaces/worktrees) from braid's DB and disk.
# Safe to run while the app is closed. Run again any time you want a clean slate.
#
# Usage:
#   ./scripts/nuke-projects.sh              # interactive: confirm before deleting
#   ./scripts/nuke-projects.sh --force      # skip confirmation
#
# What it does:
#   1. Reads all projects + their local paths + workspace branch names from SQLite
#   2. Removes git worktrees from disk  (<project_path>/<repo_name>-<branch_name>/)
#   3. Removes .code-workspace files    (~/.braid/workspaces/<projectId>.code-workspace)
#   4. Clears all braid tables:        workspaces, workspace_repos, workspace_local,
#                                        project_repositories, project_paths,
#                                        repositories, projects
#   5. Resets app-state.json            (clears lastActiveWorkspaceId, openWorkspaceIds)
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DB="$HOME/.braid/braid.db"
WORKSPACES_DIR="$HOME/.braid/workspaces"

# ── Helpers ──────────────────────────────────────────────────────────────────

sql() { sqlite3 "$DB" "$1"; }

red()   { printf '\033[0;31m%s\033[0m\n' "$*"; }
green() { printf '\033[0;32m%s\033[0m\n' "$*"; }
dim()   { printf '\033[2m%s\033[0m\n' "$*"; }

# ── Preflight ─────────────────────────────────────────────────────────────────

if [ ! -f "$DB" ]; then
  red "DB not found at $DB — nothing to do."
  exit 0
fi

PROJECT_COUNT=$(sql "SELECT COUNT(*) FROM projects;")
if [ "$PROJECT_COUNT" -eq 0 ]; then
  green "No projects in DB — already clean."
  exit 0
fi

echo ""
echo "Found $PROJECT_COUNT project(s) in DB:"
sql "SELECT '  ' || id || '  ' || name FROM projects;"
echo ""

# ── Confirmation ──────────────────────────────────────────────────────────────

if [[ "${1:-}" != "--force" ]]; then
  read -rp "This will delete all projects, workspaces, and worktrees. Continue? [y/N] " CONFIRM
  if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ── Step 1: Remove worktrees from disk ────────────────────────────────────────

echo ""
echo "Removing worktrees from disk..."

# For each workspace, derive worktree paths: <project_local_path>/<repo_name>-<branch_name>
while IFS='|' read -r branch_name local_path repo_name; do
  [ -z "$local_path" ] && continue
  worktree_path="${local_path}/${repo_name}-${branch_name}"
  if [ -d "$worktree_path" ]; then
    dim "  removing worktree: $worktree_path"
    repo_path="${local_path}/${repo_name}"
    if [ -d "$repo_path/.git" ]; then
      # Graceful git worktree remove first
      git -C "$repo_path" worktree remove --force "$worktree_path" 2>/dev/null || true
      git -C "$repo_path" worktree prune 2>/dev/null || true
    fi
    # Force remove directory if still there
    rm -rf "$worktree_path"
    green "  removed: $worktree_path"
  else
    dim "  not on disk (skipping): $worktree_path"
  fi
done < <(sql "
  SELECT w.branch_name, pp.local_path, r.name
  FROM workspaces w
  JOIN workspace_repos wr ON wr.workspace_id = w.id
  JOIN repositories r ON r.id = wr.repo_id
  JOIN project_paths pp ON pp.project_id = w.project_id;
")

# ── Step 2: Remove .code-workspace files ──────────────────────────────────────

echo ""
echo "Removing .code-workspace files..."

while IFS= read -r project_id; do
  ws_file="${WORKSPACES_DIR}/${project_id}.code-workspace"
  if [ -f "$ws_file" ]; then
    rm -f "$ws_file"
    green "  removed: $ws_file"
  else
    dim "  not found (skipping): $ws_file"
  fi
done < <(sql "SELECT id FROM projects;")

# ── Step 3: Wipe DB tables ────────────────────────────────────────────────────

echo ""
echo "Clearing DB tables..."

sql "
  DELETE FROM workspace_local;
  DELETE FROM workspace_repos;
  DELETE FROM workspaces;
  DELETE FROM project_repositories;
  DELETE FROM project_paths;
  DELETE FROM repositories;
  DELETE FROM projects;
"

green "DB cleared."

# ── Step 4: Reset app-state.json ──────────────────────────────────────────────

APP_STATE="$HOME/.braid/app-state.json"
echo ""
echo "Resetting app-state.json..."

if [ -f "$APP_STATE" ]; then
  # Preserve leftPanelCollapsed, reset workspace state
  LEFT_PANEL_COLLAPSED=$(python3 -c "
import json, sys
try:
  s = json.load(open('$APP_STATE'))
  print('true' if s.get('leftPanelCollapsed', False) else 'false')
except:
  print('false')
")
  cat > "$APP_STATE" <<EOF
{
  "lastActiveWorkspaceId": null,
  "leftPanelCollapsed": ${LEFT_PANEL_COLLAPSED},
  "openWorkspaceIds": []
}
EOF
  green "  app-state.json reset."
else
  dim "  app-state.json not found (skipping)."
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
green "Done. braid is clean."
echo ""
