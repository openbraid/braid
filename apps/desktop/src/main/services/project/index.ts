import { basename, dirname, join } from 'path'
import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import simpleGit from 'simple-git'
import { projectRepo, repositoryRepo, workspaceRepo } from '../../repositories'
import { setProjectLocalPath, upsertProjectLocalPath, deleteWorkspaceLocal } from '../../db/queries/local'
import { deleteTerminalsByWorkspace } from '../../db/queries/workspace-terminals'
import type { ProjectSetupStatus, ProjectWithRepos } from '../../../shared/ipc-types'
import { deriveRepoPath } from '../../lib/derive-paths'
import { detectRepos, getRemoteUrl } from '../../lib/git'
import { stopServer } from '../vscode-server'
import { unregisterWorkspace } from '../terminal'

export type { ProjectWithRepos }

// ─── Public API ────────────────────────────────────────────────────────────────

export async function scanFolder(
  localPath: string
): Promise<Array<{ name: string; path: string; remoteUrl: string }>> {
  return detectRepos(localPath)
}

export async function getProjects(): Promise<ProjectWithRepos[]> {
  return projectRepo.getAll()
}

/**
 * Creates a project + its repos via the backend API and stores the local path
 * in SQLite. No default workspace is created — the user creates their first
 * workspace explicitly from the project page.
 *
 * Returns the created project. Caller (handler) is responsible for pushing
 * PROJECT_CREATED event.
 */
export async function createProject(
  name: string,
  localPath: string,
  repos: Array<{ name: string; remoteUrl: string }>,
  onProgress?: (label: string, status: 'active' | 'done' | 'error', detail?: string) => void
): Promise<ProjectWithRepos> {
  let cleanPath = localPath.replace(/\/+$/, '')

  // If the selected folder IS a git repo (not a parent containing repos),
  // store the parent directory as the project path. deriveRepoPath expects
  // repos to be children of the project path: join(projectPath, repoName).
  if (repos.length === 1 && basename(cleanPath) === repos[0].name && existsSync(join(cleanPath, '.git'))) {
    cleanPath = dirname(cleanPath)
  }

  onProgress?.('Creating project', 'active')

  const project = await projectRepo.create(name, repos)

  // Store local path in SQLite (machine-specific, never synced)
  setProjectLocalPath(project.id, cleanPath)
  project.localPath = cleanPath

  onProgress?.('Creating project', 'done')

  return project
}

// ─── Setup status ─────────────────────────────────────────────────────────────
//
// Fresh filesystem check on every call. The project_paths row is not trusted on
// its own — the folder or any repo clone may have been deleted outside Braid.

export async function getSetupStatus(projectId: string): Promise<ProjectSetupStatus> {
  const localPath = await projectRepo.getLocalPath(projectId)
  if (!localPath) return { status: 'not-setup' }

  const localPathExists = existsSync(localPath)
  const repos = await repositoryRepo.getByProject(projectId)

  const missingRepoNames: string[] = []
  if (!localPathExists) {
    for (const repo of repos) missingRepoNames.push(repo.name)
  } else {
    for (const repo of repos) {
      const repoPath = deriveRepoPath(localPath, repo.name)
      if (!existsSync(join(repoPath, '.git'))) {
        missingRepoNames.push(repo.name)
      }
    }
  }

  if (missingRepoNames.length > 0) {
    return { status: 'missing', localPath, missingRepoNames, localPathExists }
  }
  return { status: 'setup', localPath }
}

// ─── Setup locally (clone into parent folder) ────────────────────────────────
//
// Idempotent: reuses existing valid clones, clones only the missing repos.
// Refuses to overwrite non-matching folders (different remote or not a repo).

export async function setupProjectLocally(
  projectId: string,
  parentFolder: string,
  onProgress?: (label: string, status: 'active' | 'done' | 'error', detail?: string) => void
): Promise<ProjectWithRepos> {
  const cleanParent = parentFolder.replace(/\/+$/, '')
  if (!cleanParent) throw new Error('Parent folder path is empty')

  const projects = await projectRepo.getAll()
  const project = projects.find((p) => p.id === projectId)
  if (!project) throw new Error(`Project not found: ${projectId}`)

  const repos = await repositoryRepo.getByProject(projectId)
  if (repos.length === 0) throw new Error('Project has no repositories to clone')

  if (!existsSync(cleanParent)) {
    await mkdir(cleanParent, { recursive: true })
  }

  for (const repo of repos) {
    const repoPath = join(cleanParent, repo.name)
    const label = `Cloning ${repo.name}`

    if (existsSync(repoPath)) {
      if (existsSync(join(repoPath, '.git'))) {
        const url = await getRemoteUrl(repoPath)
        if (url && urlsMatch(url, repo.remoteUrl)) {
          onProgress?.(label, 'done', 'already cloned')
          continue
        }
        const err: Error & { code?: string } = new Error(
          `"${repoPath}" already exists and points to a different remote (${url ?? 'unknown'}). ` +
          `Remove it or choose a different parent folder.`
        )
        err.code = 'SETUP_FOLDER_CONFLICT'
        throw err
      }
      const err: Error & { code?: string } = new Error(
        `"${repoPath}" already exists and is not a git repository. ` +
        `Remove it or choose a different parent folder.`
      )
      err.code = 'SETUP_FOLDER_CONFLICT'
      throw err
    }

    onProgress?.(label, 'active')
    try {
      await simpleGit().clone(repo.remoteUrl, repoPath)
      onProgress?.(label, 'done')
    } catch (err) {
      onProgress?.(label, 'error', err instanceof Error ? err.message : String(err))
      throw err
    }
  }

  upsertProjectLocalPath(projectId, cleanParent)
  project.localPath = cleanParent
  return project
}

// ─── Delete project ──────────────────────────────────────────────────────────
//
// Owner-only on the backend (it throws ACCESS_DENIED for non-owners). Remote
// delete runs first — if that fails we bail before touching any local state.
// On success we best-effort clean up: stop the VS Code server, kill terminals,
// drop local workspace rows for every workspace under the project. Each cleanup
// step is isolated so one failure doesn't cascade.

export async function deleteProject(projectId: string): Promise<{ id: string; name: string }> {
  const projects = await projectRepo.getAll()
  const project = projects.find((p) => p.id === projectId)
  if (!project) {
    const err: Error & { code?: string } = new Error('Project not found')
    err.code = 'PROJECT_NOT_FOUND'
    throw err
  }

  const workspaces = await workspaceRepo.getByProject(projectId)

  // Remote delete first — if this throws (ACCESS_DENIED, network, etc.), we
  // leave the local environment untouched.
  await projectRepo.delete(projectId)

  // Best-effort local cleanup. Order: terminals → vscode server → local DB rows.
  for (const ws of workspaces) {
    try { unregisterWorkspace(ws.id) } catch (err) {
      console.error(`[deleteProject] unregisterWorkspace(${ws.id}) failed:`, err)
    }
    try { deleteTerminalsByWorkspace(ws.id) } catch (err) {
      console.error(`[deleteProject] deleteTerminalsByWorkspace(${ws.id}) failed:`, err)
    }
    try { deleteWorkspaceLocal(ws.id) } catch (err) {
      console.error(`[deleteProject] deleteWorkspaceLocal(${ws.id}) failed:`, err)
    }
  }

  try { await stopServer(projectId) } catch (err) {
    console.error(`[deleteProject] stopServer(${projectId}) failed:`, err)
  }

  return { id: project.id, name: project.name }
}

// Loose remote URL comparison — handles .git suffix and http/ssh variants of the same repo.
function urlsMatch(a: string, b: string): boolean {
  return normalizeRemoteUrl(a) === normalizeRemoteUrl(b)
}

function normalizeRemoteUrl(url: string): string {
  let s = url.trim().toLowerCase()
  if (s.endsWith('.git')) s = s.slice(0, -4)
  // git@github.com:org/repo → github.com/org/repo
  s = s.replace(/^git@([^:]+):/, '$1/')
  // https://github.com/org/repo → github.com/org/repo
  s = s.replace(/^https?:\/\//, '')
  s = s.replace(/^ssh:\/\/git@/, '')
  return s.replace(/\/+$/, '')
}
