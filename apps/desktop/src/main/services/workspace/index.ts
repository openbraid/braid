import type { WorkspaceWithLocal } from '../../../shared/ipc-types'
import { WorkspaceBrokenReasonCode } from '../../../shared/ipc-types'
import { getAppState, setAppState } from '../../lib/app-state'
import { clearWorkspaceSyncVersions } from '../../lib/sync-state'
import {
  deriveWorktreePath,
  deriveWorkspaceFilePath,
  deriveArtifactDir,
  deriveRepoBraidDir
} from '../../lib/derive-paths'
import { initArtifactFolder } from '../artifact'
import { stopWatching } from '../artifact/file-watcher'
import { injectWorkspaceConfig, injectAgentInstructions } from './inject-context'
import {
  projectRepo,
  workspaceRepo,
  workspaceRepoRepo,
  repositoryRepo,
  instructionRepo
} from '../../repositories'
import {
  validateBranch,
  createWorktrees,
  removeWorktrees,
  validateWorktrees,
  generateCodeWorkspaceFile,
  resolveIsMultiRepo,
  addRepoWorktree
} from '../worktree'
import { getOrStartServer, stopServer } from '../vscode-server'
import {
  registerWorktree,
  unregisterWorkspace,
  notifyWorkspaceVisited as terminalNotifyVisited
} from '../terminal'
import { getSetupStatus } from '../project'

// Re-export so IPC handlers only import from workspace service (layer rule: handler → service)
export { terminalNotifyVisited as notifyWorkspaceVisited }

// ─── Core: ensureWorkspaceReady ──────────────────────────────────────────────
//
// Single function that makes a workspace fully operational. Every step is
// idempotent — safe to call regardless of current state. All lifecycle
// entry points (create, open, reopen, repair) converge here.

async function ensureWorkspaceReady(workspaceId: string): Promise<WorkspaceWithLocal> {
  const workspace = await workspaceRepo.getById(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (!localPath) {
    await workspaceRepo.markBroken(workspaceId, WorkspaceBrokenReasonCode.MissingProjectPath)
    return (await workspaceRepo.getById(workspaceId))!
  }

  const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
  const openWorkspaceIds = await getOpenWorkspaceIdsForProject(workspace.projectId)

  // Step 1: Ensure worktrees exist on disk
  const healthy = await validateWorktrees(workspaceId, workspace)
  if (!healthy) {
    console.log(`[workspace] ensureReady: worktrees missing, creating for "${workspace.name}"`)
    await createWorktrees(workspaceId, workspace, openWorkspaceIds)
  }

  // Step 2: Ensure artifact folder exists
  const braidDir = deriveArtifactDir(localPath, workspace.sanitizedName, isMultiRepo)
  initArtifactFolder(braidDir)

  // Step 3: Regenerate .code-workspace file (cheap, always correct)
  await generateCodeWorkspaceFile(workspace.projectId, openWorkspaceIds)

  // Step 4: Ensure VS Code server is running
  const workspaceFilePath = deriveWorkspaceFilePath(workspace.projectId, workspace.sanitizedName)
  await getOrStartServer(workspace.projectId, workspaceFilePath)

  // Step 5: Register worktree paths for terminal tracking (idempotent)
  const repos = await workspaceRepoRepo.getReposByWorkspace(workspaceId)
  for (const repo of repos) {
    registerWorktree(
      deriveWorktreePath(localPath, repo.name, workspace.sanitizedName, isMultiRepo),
      workspaceId
    )
  }

  // Step 6: Inject workspace context and agent instruction files
  try {
    const projects = await projectRepo.getAll()
    const project = projects.find((p) => p.id === workspace.projectId)
    const projectName = project?.name ?? workspace.projectId

    // Where agents might run — single-repo: [worktree], multi-repo: [repo1, repo2, ...]
    const repoRoots = repos.map((r) =>
      deriveWorktreePath(localPath, r.name, workspace.sanitizedName, isMultiRepo)
    )

    // Primary .braid/ root (where artifacts live)
    // Single-repo: <worktree>/.braid/  (parent of the branch-named artifact subfolder)
    // Multi-repo:  <workspaceFolder>/.braid/
    const braidRoot = isMultiRepo ? braidDir : deriveRepoBraidDir(repoRoots[0] ?? localPath)

    const config = {
      workspaceId,
      workspaceName: workspace.name,
      sanitizedName: workspace.sanitizedName,
      projectName,
      artifactDir: braidDir,
      isMultiRepo,
      repos: repoRoots.map((path, i) => ({ name: repos[i].name, path }))
    }

    // Fetch project settings to know which agents are selected
    let selectedAgents: string[] = []
    let artifactsEnabled = false
    try {
      const settings = await projectRepo.getSettings(workspace.projectId)
      selectedAgents = settings.selectedAgents
      artifactsEnabled = settings.artifactsEnabled
    } catch (err) {
      console.warn('[workspace] Failed to fetch project settings (non-fatal):', err)
    }

    // Write workspace.local.md into every .braid/ and agent rules directory
    injectWorkspaceConfig(braidRoot, repoRoots, isMultiRepo, selectedAgents, config)

    // Write agent-specific instruction files (best-effort)
    if (artifactsEnabled && selectedAgents.length > 0) {
      try {
        const instructionContent = await instructionRepo.getAgentInstructions()
        await injectAgentInstructions(
          braidRoot,
          repoRoots,
          isMultiRepo,
          selectedAgents,
          instructionContent
        )
      } catch (err) {
        console.warn('[workspace] Agent instruction injection failed (non-fatal):', err)
      }
    }
  } catch (err) {
    console.warn('[workspace] Context injection failed (non-fatal):', err)
  }

  // Step 7: Update status + timestamps + app-state
  if (workspace.status !== 'open') {
    await workspaceRepo.updateStatus(workspaceId, 'open')
  }
  await workspaceRepo.updateLastOpened(workspaceId)

  const appState = getAppState()
  setAppState({
    openWorkspaceIds: appState.openWorkspaceIds.includes(workspaceId)
      ? appState.openWorkspaceIds
      : [...appState.openWorkspaceIds, workspaceId],
    lastActiveWorkspaceId: workspaceId
  })

  return (await workspaceRepo.getById(workspaceId))!
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export async function getOpenWorkspaceIdsForProject(projectId: string): Promise<string[]> {
  const workspaces = await workspaceRepo.getByProject(projectId)
  return workspaces.filter((ws) => ws.status === 'open').map((ws) => ws.id)
}

// ─── VS Code URL ──────────────────────────────────────────────────────────────

export async function getVscodeUrl(workspaceId: string): Promise<string | null> {
  const workspace = await workspaceRepo.getById(workspaceId)
  if (!workspace) return null

  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (!localPath) return null

  const workspaceFilePath = deriveWorkspaceFilePath(workspace.projectId, workspace.sanitizedName)
  const port = await getOrStartServer(workspace.projectId, workspaceFilePath)
  const url = `http://127.0.0.1:${port}/?workspace=${encodeURIComponent(workspaceFilePath)}`

  console.log(`[workspace] getVscodeUrl: workspace=${workspaceId} url=${url}`)
  return url
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function createWorkspace(payload: {
  projectId: string
  name: string
  branchName: string
  sourceBranch: string
  repos?: Array<{ repoId: string; sourceBranch?: string }>
}): Promise<WorkspaceWithLocal> {
  const { projectId, name, branchName, sourceBranch, repos: repoInputs } = payload
  console.log(
    `[workspace] createWorkspace: name="${name}" branch="${branchName}" source="${sourceBranch}" project=${projectId}`
  )

  // Pre-check: project must be set up locally. Done BEFORE any DB insert so
  // we never create a workspace row that's immediately marked broken.
  const setup = await getSetupStatus(projectId)
  if (setup.status !== 'setup') {
    const err: Error & { code?: string } = new Error(
      'This project is not set up on your machine yet. Set it up locally before creating a workspace.'
    )
    err.code = 'PROJECT_NOT_SETUP_LOCALLY'
    throw err
  }

  // Validate branch is not already in use
  const validation = await validateBranch(projectId, branchName)
  if (!validation.valid) {
    throw new Error(
      `Branch "${branchName}" is already used by workspace "${validation.workspaceName}"`
    )
  }

  // Create DB records (backend computes sanitizedName and handles repo linking)
  const workspace = await workspaceRepo.create({
    projectId,
    name,
    branchName,
    sourceBranch,
    repos: repoInputs
  })
  console.log(
    `[workspace] workspace created: id=${workspace.id} sanitizedName=${workspace.sanitizedName}`
  )

  // Make workspace operational
  return ensureWorkspaceReady(workspace.id)
}

export async function openWorkspace(workspaceId: string): Promise<WorkspaceWithLocal> {
  return ensureWorkspaceReady(workspaceId)
}

export async function reopenWorkspace(workspaceId: string): Promise<WorkspaceWithLocal> {
  return ensureWorkspaceReady(workspaceId)
}

export async function repairWorkspace(workspaceId: string): Promise<WorkspaceWithLocal> {
  return ensureWorkspaceReady(workspaceId)
}

/**
 * Tier 1 health check — run once on app launch, fire-and-forget from renderer.
 * Returns the workspaceId if it was marked broken, otherwise null.
 */
export async function validateOpenWorktrees(): Promise<string | null> {
  const appState = getAppState()
  const lastActiveId = appState.lastActiveWorkspaceId
  console.log(`[workspace] validateOpenWorktrees: lastActiveWorkspaceId=${lastActiveId ?? 'none'}`)

  if (!lastActiveId) return null

  const workspace = await workspaceRepo.getById(lastActiveId)

  if (!workspace) {
    console.warn(`[workspace] Tier 1: ${lastActiveId} not in DB — clearing from app-state`)
    setAppState({ lastActiveWorkspaceId: null })
    return null
  }

  if (workspace.status !== 'open') {
    console.log(
      `[workspace] Tier 1: workspace status=${workspace.status} — clearing lastActiveWorkspaceId`
    )
    setAppState({ lastActiveWorkspaceId: null })
    return null
  }

  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (!localPath) {
    console.warn(`[workspace] Tier 1: "${workspace.name}" has no project path — marking broken`)
    await workspaceRepo.markBroken(workspace.id, WorkspaceBrokenReasonCode.MissingProjectPath)
    setAppState({ lastActiveWorkspaceId: null })
    return workspace.id
  }

  const healthy = await validateWorktrees(workspace.id, workspace)
  console.log(`[workspace] Tier 1: "${workspace.name}" healthy=${healthy}`)

  if (!healthy) {
    console.warn(`[workspace] Tier 1: "${workspace.name}" has missing worktrees — marking broken`)
    await workspaceRepo.markBroken(workspace.id, WorkspaceBrokenReasonCode.MissingWorktree)
    setAppState({ lastActiveWorkspaceId: null })
    return workspace.id
  }

  return null
}

export async function closeWorkspace(workspaceId: string, removeFiles: boolean): Promise<void> {
  const workspace = await workspaceRepo.getById(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

  const remainingOpenIds = (await getOpenWorkspaceIdsForProject(workspace.projectId)).filter(
    (id) => id !== workspaceId
  )

  if (removeFiles) {
    await removeWorktrees(workspaceId, workspace, remainingOpenIds)
    await workspaceRepo.updateStatus(workspaceId, 'closed_clean')
    clearWorkspaceSyncVersions(workspaceId)
  } else {
    await generateCodeWorkspaceFile(workspace.projectId, remainingOpenIds)
    await workspaceRepo.updateStatus(workspaceId, 'closed_with_files')
  }

  const appState = getAppState()
  setAppState({
    openWorkspaceIds: appState.openWorkspaceIds.filter((id) => id !== workspaceId),
    lastActiveWorkspaceId:
      appState.lastActiveWorkspaceId === workspaceId ? null : appState.lastActiveWorkspaceId
  })

  unregisterWorkspace(workspaceId)

  // Stop artifact watcher
  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (localPath) {
    const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
    const braidDir = deriveArtifactDir(localPath, workspace.sanitizedName, isMultiRepo)
    stopWatching(braidDir)
  }

  if (remainingOpenIds.length === 0) {
    await stopServer(workspace.projectId)
  }
}

/**
 * Add a repo to an existing workspace.
 */
export async function addRepoToWorkspace(
  workspaceId: string,
  repoId: string
): Promise<WorkspaceWithLocal> {
  const workspace = await workspaceRepo.getById(workspaceId)
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`)

  const projectRepos = await repositoryRepo.getByProject(workspace.projectId)
  const repo = projectRepos.find((r) => r.id === repoId)
  if (!repo) throw new Error(`Repository ${repoId} not found in project ${workspace.projectId}`)

  const wsRepos = await workspaceRepoRepo.getReposByWorkspace(workspaceId)
  if (wsRepos.some((r) => r.id === repoId)) {
    throw new Error(`Repository "${repo.name}" is already in workspace "${workspace.name}"`)
  }

  await workspaceRepoRepo.linkRepos(workspaceId, [repoId])

  const openWorkspaceIds = await getOpenWorkspaceIdsForProject(workspace.projectId)
  await addRepoWorktree(workspaceId, repo, workspace, openWorkspaceIds)

  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (localPath) {
    const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
    registerWorktree(
      deriveWorktreePath(localPath, repo.name, workspace.sanitizedName, isMultiRepo),
      workspaceId
    )
  }

  return (await workspaceRepo.getById(workspaceId))!
}

export async function hydrateWorktreeMap(): Promise<void> {
  const allWorkspaces = (await workspaceRepo.getAll()).filter((ws) => ws.status === 'open')

  for (const workspace of allWorkspaces) {
    const localPath = await projectRepo.getLocalPath(workspace.projectId)
    if (!localPath) continue
    const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
    const repos = await workspaceRepoRepo.getReposByWorkspace(workspace.id)
    for (const repo of repos) {
      registerWorktree(
        deriveWorktreePath(localPath, repo.name, workspace.sanitizedName, isMultiRepo),
        workspace.id
      )
    }
  }

  console.log(
    `[workspace] hydrateWorktreeMap: registered ${allWorkspaces.length} open workspace(s)`
  )
}
