import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, statSync, writeFileSync } from 'fs'
import { basename, dirname, join } from 'path'
import {
  branchExists,
  fetchBranch,
  createWorktree,
  removeWorktree,
  pruneWorktrees,
  pushBranch,
  getRemoteUrl
} from '../../lib/git'
import { installWorktreeHooks } from '../../lib/git-hooks'
import {
  deriveWorktreePath,
  deriveRepoPath,
  deriveWorkspaceFilePath,
  deriveWorkspaceFolderPath,
  deriveArtifactDir
} from '../../lib/derive-paths'
import { projectRepo, workspaceRepo, workspaceRepoRepo, repositoryRepo } from '../../repositories'
import type { Repository } from '../../db/schema'
import { getTerminalWsPort } from '../vscode-server'

// ─── Common workspace shape used by most functions ──────────────────────────

type WorkspaceRef = {
  branchName: string
  sanitizedName: string
  sourceBranch: string
  projectId: string
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type BranchValidationResult =
  | { valid: false; reason: 'BRANCH_IN_USE'; workspaceName: string; workspaceId: string }
  | { valid: true; action: 'USE_EXISTING' }
  | { valid: true; action: 'CREATE_NEW' }

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Determine if a project has multiple repos (checked at project level, not workspace level).
 */
export async function resolveIsMultiRepo(projectId: string): Promise<boolean> {
  const repos = await repositoryRepo.getByProject(projectId)
  return repos.length > 1
}

// ─── Branch Validation ────────────────────────────────────────────────────────

/**
 * Validate a proposed branch name for a new workspace.
 *
 * Case A: branch already tied to a workspace in DB → invalid
 * Case B: sanitized workspace name collides with a repo name → invalid
 * Case C: branch exists in git (any repo) but not in DB → use existing
 * Case D: branch doesn't exist in any repo → create new
 */
export async function validateBranch(
  projectId: string,
  branchName: string
): Promise<BranchValidationResult> {
  const localPath = await projectRepo.getLocalPath(projectId)
  if (!localPath) throw new Error(`No local path found for project ${projectId}`)

  // Case A: branch already tied to an existing workspace in DB
  const existingWorkspaces = await workspaceRepo.getByProject(projectId)
  const conflict = existingWorkspaces.find((w) => w.branchName === branchName)
  if (conflict) {
    return { valid: false, reason: 'BRANCH_IN_USE', workspaceName: conflict.name, workspaceId: conflict.id }
  }

  // Check all repos — Case B if branch exists in ANY repo
  const allProjectRepos = await repositoryRepo.getByProject(projectId)
  for (const repo of allProjectRepos) {
    const repoPath = deriveRepoPath(localPath, repo.name)
    if (await branchExists(repoPath, branchName)) {
      return { valid: true, action: 'USE_EXISTING' }
    }
  }

  // Case D: branch exists in no repo
  return { valid: true, action: 'CREATE_NEW' }
}

// ─── Worktree Creation ────────────────────────────────────────────────────────

export async function createWorktrees(
  workspaceId: string,
  workspace: WorkspaceRef,
  openWorkspaceIds: string[]
): Promise<void> {
  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (!localPath) throw new Error(`No local path found for project ${workspace.projectId}`)

  const repos = await workspaceRepoRepo.getReposByWorkspace(workspaceId)
  const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
  const created: Array<{ repoPath: string; worktreePath: string }> = []

  // For multi-repo: create the workspace folder first
  if (isMultiRepo) {
    const wsFolder = deriveWorkspaceFolderPath(localPath, workspace.sanitizedName)
    if (!existsSync(wsFolder)) {
      mkdirSync(wsFolder, { recursive: true })
      console.log(`[worktree] created workspace folder: ${wsFolder}`)
    }
  }

  try {
    for (const repo of repos) {
      const repoPath = deriveRepoPath(localPath, repo.name)
      // sanitizedName for filesystem paths, branchName for git operations
      const worktreePath = deriveWorktreePath(localPath, repo.name, workspace.sanitizedName, isMultiRepo)

      // Fetch workspace branch and source branch from remote so they're up to date
      await fetchBranch(repoPath, workspace.branchName)
      const rawSourceBranch = repo.sourceBranch ?? workspace.sourceBranch
      if (rawSourceBranch) {
        await fetchBranch(repoPath, rawSourceBranch)
      }

      const exists = await branchExists(repoPath, workspace.branchName)
      // Use origin/<source> so the worktree gets the latest remote content
      // without needing to update the local source branch
      const repoSourceBranch = exists ? null : (rawSourceBranch ? `origin/${rawSourceBranch}` : null)

      console.log(`[worktree] creating worktree: repo=${repo.name} path=${worktreePath} branch=${workspace.branchName} newBranch=${!exists} sourceBranch=${repoSourceBranch ?? 'n/a'} isMultiRepo=${isMultiRepo}`)
      await createWorktree(repoPath, worktreePath, workspace.branchName, repoSourceBranch)
      console.log(`[worktree] created worktree: ${worktreePath}`)

      // Install Braid git hooks (commit trailers + artifact copy for multi-repo)
      await installWorktreeHooks(worktreePath, repoPath)

      created.push({ repoPath, worktreePath })
    }
  } catch (err) {
    console.error(`[worktree] createWorktree failed, rolling back ${created.length} created worktree(s):`, err)
    for (const { repoPath, worktreePath } of created) {
      await removeWorktree(repoPath, worktreePath)
    }
    throw err
  }

  // Push new branch to remote — skip if no remote configured
  for (const repo of repos) {
    const repoPath = deriveRepoPath(localPath, repo.name)
    const remoteUrl = await getRemoteUrl(repoPath)
    if (!remoteUrl) {
      console.log(`[worktree] skipping push for ${repo.name}: no remote configured`)
      continue
    }
    try {
      console.log(`[worktree] pushing branch ${workspace.branchName} for ${repo.name}`)
      await pushBranch(repoPath, workspace.branchName)
      console.log(`[worktree] pushed branch ${workspace.branchName} for ${repo.name}`)
    } catch (err) {
      console.warn(`[worktree] push failed for ${repo.name} (non-fatal):`, err)
    }
  }

  await generateCodeWorkspaceFile(workspace.projectId, openWorkspaceIds)
}

// ─── Worktree Removal ─────────────────────────────────────────────────────────

export async function removeWorktrees(
  workspaceId: string,
  workspace: Pick<WorkspaceRef, 'sanitizedName' | 'projectId'>,
  openWorkspaceIds: string[]
): Promise<void> {
  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (!localPath) throw new Error(`No local path found for project ${workspace.projectId}`)

  const repos = await workspaceRepoRepo.getReposByWorkspace(workspaceId)
  const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)

  for (const repo of repos) {
    const repoPath = deriveRepoPath(localPath, repo.name)
    const worktreePath = deriveWorktreePath(localPath, repo.name, workspace.sanitizedName, isMultiRepo)
    await removeWorktree(repoPath, worktreePath)
    await pruneWorktrees(repoPath)
  }

  // For multi-repo: remove .braid folder and workspace folder
  if (isMultiRepo) {
    const wsFolder = deriveWorkspaceFolderPath(localPath, workspace.sanitizedName)
    try {
      // Remove the artifacts folder
      const artifactDir = deriveArtifactDir(localPath, workspace.sanitizedName, isMultiRepo)
      if (existsSync(artifactDir)) {
        const { rmSync } = require('fs')
        rmSync(artifactDir, { recursive: true })
        console.log(`[worktree] removed artifact folder: ${artifactDir}`)
      }
      // Remove workspace folder if now empty
      if (existsSync(wsFolder)) {
        const remaining = readdirSync(wsFolder)
        if (remaining.length === 0) {
          rmdirSync(wsFolder)
          console.log(`[worktree] removed workspace folder: ${wsFolder}`)
        }
      }
    } catch (err) {
      console.warn(`[worktree] failed to clean workspace folder (non-fatal):`, err)
    }
  }

  await generateCodeWorkspaceFile(workspace.projectId, openWorkspaceIds)
}

// ─── Worktree Validation ──────────────────────────────────────────────────────

export async function validateWorktrees(
  workspaceId: string,
  workspace: Pick<WorkspaceRef, 'sanitizedName' | 'projectId'>
): Promise<boolean> {
  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (!localPath) {
    console.log(`[worktree] validateWorktrees: no localPath for project ${workspace.projectId} → false`)
    return false
  }

  const repos = await workspaceRepoRepo.getReposByWorkspace(workspaceId)
  const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
  console.log(`[worktree] validateWorktrees: workspaceId=${workspaceId} isMultiRepo=${isMultiRepo} repos=[${repos.map(r => r.name).join(', ')}]`)
  for (const repo of repos) {
    const worktreePath = deriveWorktreePath(localPath, repo.name, workspace.sanitizedName, isMultiRepo)
    if (!existsSync(worktreePath)) {
      console.log(`[worktree] validateWorktrees: path="${worktreePath}" missing → false`)
      return false
    }
    // Folder exists — also verify git linkage. A worktree's .git is a *file*
    // pointing to `<mainRepo>/.git/worktrees/<name>`. If the main repo was deleted
    // (or re-cloned, which wipes the worktrees registry), that gitdir is gone
    // and any git command inside this folder will fail. Treat as unhealthy so
    // ensureWorkspaceReady rebuilds it.
    const dotGit = join(worktreePath, '.git')
    if (!existsSync(dotGit)) {
      console.log(`[worktree] validateWorktrees: .git missing at "${worktreePath}" → false`)
      return false
    }
    try {
      if (statSync(dotGit).isFile()) {
        const content = readFileSync(dotGit, 'utf-8').trim()
        if (content.startsWith('gitdir:')) {
          const gitdir = content.slice('gitdir:'.length).trim()
          if (!existsSync(gitdir)) {
            console.log(`[worktree] validateWorktrees: orphaned worktree "${worktreePath}" (gitdir="${gitdir}" gone) → false`)
            return false
          }
        }
      }
    } catch (err) {
      console.log(`[worktree] validateWorktrees: failed to read .git at "${worktreePath}" → false`, err)
      return false
    }
  }
  return true
}

// ─── .code-workspace File ─────────────────────────────────────────────────────

export function patchWorkspaceFilePort(projectId: string, sanitizedName: string, terminalWsPort: number): void {
  const filePath = deriveWorkspaceFilePath(projectId, sanitizedName)
  let parsed: Record<string, unknown> = {}
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown>
  } catch {
    return
  }
  parsed.braidProjectId = projectId
  parsed.braidTerminalWsPort = terminalWsPort
  writeFileSync(filePath, JSON.stringify(parsed, null, 2), 'utf-8')
}

export async function generateCodeWorkspaceFile(
  projectId: string,
  openWorkspaceIds: string[]
): Promise<void> {
  const localPath = await projectRepo.getLocalPath(projectId)
  if (!localPath) throw new Error(`No local path found for project ${projectId}`)

  const isMultiRepo = await resolveIsMultiRepo(projectId)

  // Generate one .code-workspace file per open workspace
  for (const wsId of openWorkspaceIds) {
    const repos = await workspaceRepoRepo.getReposByWorkspace(wsId)
    const wsRecord = await _getWorkspaceRecord(projectId, wsId)
    if (!wsRecord) continue

    const folders: Array<{ path: string; name: string }> = []

    for (const repo of repos) {
      const worktreePath = deriveWorktreePath(localPath, repo.name, wsRecord.sanitizedName, isMultiRepo)
      if (existsSync(worktreePath)) {
        folders.push({ path: worktreePath, name: repo.name })
      }
    }

    // For multi-repo: add the artifacts folder as a visible root
    if (isMultiRepo) {
      const artifactDir = deriveArtifactDir(localPath, wsRecord.sanitizedName, isMultiRepo)
      if (existsSync(artifactDir)) {
        folders.push({ path: artifactDir, name: basename(artifactDir) })
      }
    }

    const filePath = deriveWorkspaceFilePath(projectId, wsRecord.sanitizedName)
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const terminalWsPort = getTerminalWsPort(projectId)
    const braidMeta = terminalWsPort !== null
      ? { braidProjectId: projectId, braidTerminalWsPort: terminalWsPort }
      : {}

    const content = JSON.stringify({ folders, settings: {}, ...braidMeta }, null, 2)
    writeFileSync(filePath, content, 'utf-8')
  }
}

// ─── Add Single Repo Worktree ────────────────────────────────────────────────

/**
 * Add a single repo's worktree to an existing workspace.
 * Used when adding a repo to a workspace after creation.
 */
export async function addRepoWorktree(
  _workspaceId: string,
  repo: Repository,
  workspace: WorkspaceRef,
  openWorkspaceIds: string[]
): Promise<void> {
  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (!localPath) throw new Error(`No local path found for project ${workspace.projectId}`)

  const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
  const repoPath = deriveRepoPath(localPath, repo.name)
  const worktreePath = deriveWorktreePath(localPath, repo.name, workspace.sanitizedName, isMultiRepo)
  // For multi-repo: ensure workspace folder exists
  if (isMultiRepo) {
    const wsFolder = deriveWorkspaceFolderPath(localPath, workspace.sanitizedName)
    if (!existsSync(wsFolder)) {
      mkdirSync(wsFolder, { recursive: true })
    }
  }

  // Fetch workspace branch and source branch from remote
  await fetchBranch(repoPath, workspace.branchName)
  if (workspace.sourceBranch) {
    await fetchBranch(repoPath, workspace.sourceBranch)
  }

  const exists = await branchExists(repoPath, workspace.branchName)
  const sourceBranch = exists ? null : (workspace.sourceBranch ? `origin/${workspace.sourceBranch}` : null)

  console.log(`[worktree] addRepoWorktree: repo=${repo.name} path=${worktreePath} branch=${workspace.branchName}`)
  await createWorktree(repoPath, worktreePath, workspace.branchName, sourceBranch)

  await installWorktreeHooks(worktreePath, repoPath)

  // Push branch for the new repo
  const remoteUrl = await getRemoteUrl(repoPath)
  if (remoteUrl) {
    try {
      await pushBranch(repoPath, workspace.branchName)
    } catch (err) {
      console.warn(`[worktree] push failed for ${repo.name} (non-fatal):`, err)
    }
  }

  await generateCodeWorkspaceFile(workspace.projectId, openWorkspaceIds)
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function _getWorkspaceRecord(
  projectId: string,
  workspaceId: string
): Promise<{ sanitizedName: string; branchName: string } | null> {
  const workspaces = await workspaceRepo.getByProject(projectId)
  const ws = workspaces.find((w) => w.id === workspaceId)
  return ws ? { sanitizedName: ws.sanitizedName, branchName: ws.branchName } : null
}

// ─── Derive paths (convenience re-export for callers) ─────────────────────────

export async function deriveWorktreePathsForWorkspace(
  _workspaceId: string,
  workspace: Pick<WorkspaceRef, 'sanitizedName' | 'projectId'>,
  repos: Repository[]
): Promise<string[]> {
  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (!localPath) return []
  const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
  return repos.map((repo) => deriveWorktreePath(localPath, repo.name, workspace.sanitizedName, isMultiRepo))
}
