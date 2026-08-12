import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Two directories, same name, opposite migration stories — keep them separate.
//
// APP_DIR lives under $HOME and holds this machine's state: the SQLite database,
// config, VS Code server data, dictation models. It is ours, so it is migrated
// once at startup (see lib/migrate-app-dir.ts) and the old name then disappears.
//
// ARTIFACT_DIR lives inside the *user's git repositories* and is committed to
// their history. We cannot rename it out from under them: a checkout of an older
// branch, or a teammate on an older release, will still have `.tracigo/`. So the
// legacy name is read forever and only new directories use the current one.

export const APP_DIR = '.braid'
export const ARTIFACT_DIR = '.braid'
export const LEGACY_ARTIFACT_DIR = '.tracigo'

/**
 * Strips characters that could escape the intended directory:
 * path separators, null bytes, and dot-dot sequences.
 * Applied to any user-derived segment before joining into a path.
 */
export function sanitizePathSegment(segment: string): string {
  return segment
    .replace(/\.\./g, '')    // no dot-dot traversal
    .replace(/[/\\]/g, '-')  // no path separators — convert to hyphen
    .replace(/\0/g, '')      // no null bytes
    .replace(/^\.+/, '')     // no leading dots (hidden file/dir names)
}

/**
 * Workspace folder path — named by sanitizedName (computed once by backend).
 * Single-repo: this IS the worktree itself.
 * Multi-repo: this contains repo-named subdirectories (each a worktree).
 */
export function deriveWorkspaceFolderPath(
  projectLocalPath: string,
  sanitizedName: string
): string {
  return join(projectLocalPath, sanitizedName)
}

/**
 * Git worktree path for a specific repo within a workspace.
 * Single-repo: <projectPath>/<sanitizedName>/              (direct worktree)
 * Multi-repo:  <projectPath>/<sanitizedName>/<repoName>/   (nested under workspace folder)
 *
 * @param sanitizedName - pre-sanitized by backend, safe for filesystem use
 */
export function deriveWorktreePath(
  projectLocalPath: string,
  repoName: string,
  sanitizedName: string,
  isMultiRepo: boolean
): string {
  if (isMultiRepo) {
    return join(projectLocalPath, sanitizedName, sanitizePathSegment(repoName))
  }
  return join(projectLocalPath, sanitizedName)
}

/**
 * Original repo clone path — unchanged.
 */
export function deriveRepoPath(projectLocalPath: string, repoName: string): string {
  return join(projectLocalPath, sanitizePathSegment(repoName))
}

/**
 * Artifact directory — where YAML artifact files live (source of truth).
 * Single-repo: <worktree>/.braid/<sanitizedName>/     (inside the worktree, namespaced)
 * Multi-repo:  <workspaceFolder>/.braid/              (workspace-level, above repos)
 *
 * Returns the legacy `.tracigo` path when that directory already exists and the
 * current one does not — a repo written by an older release keeps working, and
 * its artifacts are never silently orphaned.
 */
export function deriveArtifactDir(
  projectLocalPath: string,
  sanitizedName: string,
  isMultiRepo: boolean
): string {
  const base = join(projectLocalPath, sanitizedName)
  const current = isMultiRepo
    ? join(base, ARTIFACT_DIR)
    : join(base, ARTIFACT_DIR, sanitizedName)
  const legacy = isMultiRepo
    ? join(base, LEGACY_ARTIFACT_DIR)
    : join(base, LEGACY_ARTIFACT_DIR, sanitizedName)

  return resolveArtifactDir(current, legacy)
}

/**
 * Where the commit hook copies artifacts inside a repo worktree (multi-repo only).
 * Path: <worktreePath>/.braid/<sanitizedName>/
 * Each workspace's artifacts get their own subfolder so they don't overwrite
 * artifacts from other workspaces after PRs merge.
 */
export function deriveRepoArtifactCopyDir(
  worktreePath: string,
  sanitizedName: string
): string {
  return resolveArtifactDir(
    join(worktreePath, ARTIFACT_DIR, sanitizedName),
    join(worktreePath, LEGACY_ARTIFACT_DIR, sanitizedName)
  )
}

/**
 * The Braid directory at the root of a repo or worktree — the one holding
 * `setup.sh`, `hooks/`, and injected agent context.
 *
 * Same legacy rule as artifacts: a repo checked out from a branch created by an
 * older release has `.tracigo/`, and its setup script must still be found.
 */
export function deriveRepoBraidDir(repoRoot: string): string {
  return resolveArtifactDir(join(repoRoot, ARTIFACT_DIR), join(repoRoot, LEGACY_ARTIFACT_DIR))
}

/**
 * Prefers the current directory name, falls back to the legacy one only when it
 * is the only one present. When neither exists the current name is returned, so
 * anything newly created adopts it.
 */
function resolveArtifactDir(current: string, legacy: string): string {
  if (!existsSync(current) && existsSync(legacy)) return legacy
  return current
}

/**
 * VS Code .code-workspace file path.
 * Named by sanitizedName so VS Code title bar shows the workspace name.
 * projectId prefix ensures uniqueness across projects.
 */
export function deriveWorkspaceFilePath(projectId: string, sanitizedName?: string): string {
  const fileName = sanitizedName
    ? `${sanitizedName}.code-workspace`
    : `${projectId}.code-workspace`
  return join(homedir(), APP_DIR, 'workspaces', projectId, fileName)
}

export function deriveVscodeDataDir(projectId: string): string {
  return join(homedir(), APP_DIR, 'vscode-data', projectId)
}

export function deriveVscodeExtensionsDir(): string {
  return join(homedir(), APP_DIR, 'vscode-extensions')
}

export function deriveVscodeSharedUserDataDir(): string {
  return join(homedir(), APP_DIR, 'vscode-user-data')
}

export function deriveTerminalPortFilePath(vscodePort: number): string {
  return join(homedir(), APP_DIR, 'terminal-ports', `${vscodePort}.json`)
}

/**
 * Full path to a specific artifact YAML file.
 * e.g. .braid/add-auth/requirements.yaml (single-repo)
 *      .braid/requirements.yaml (multi-repo workspace level)
 */
export function deriveArtifactFilePath(braidDir: string, kind: string): string {
  return join(braidDir, `${sanitizePathSegment(kind.toLowerCase())}.yaml`)
}
