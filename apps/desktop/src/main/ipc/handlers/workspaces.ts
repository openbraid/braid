import { existsSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import { Capability, Channels, type WorkspaceLifecycleStatus } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import { isCapabilityEnabled } from '../../services/capabilities'
import { apiClient } from '../../lib/api-client'
import { listBranches } from '../../lib/git'
import { deriveRepoPath, deriveWorktreePath, deriveRepoBraidDir } from '../../lib/derive-paths'
import { projectRepo, workspaceRepo, workspaceRepoRepo, repositoryRepo } from '../../repositories'
import { getShellEnv } from '../../lib/shell-env'
import { updateWorkspaceLocalPinned } from '../../db/queries/local'
import simpleGit from 'simple-git'
import {
  createWorkspace,
  openWorkspace,
  closeWorkspace,
  reopenWorkspace,
  repairWorkspace,
  validateOpenWorktrees,
  getVscodeUrl,
  notifyWorkspaceVisited,
  addRepoToWorkspace
} from '../../services/workspace'
import { resolveIsMultiRepo } from '../../services/worktree'

type PushFn = (channel: string, payload: unknown) => void

export function registerWorkspaceHandlers(push: PushFn): void {
  handleIpc(Channels.WORKSPACE_LIST, async () => {
    return workspaceRepo.getAll()
  })

  // Deduplicated workspace creation — rapid double-calls return the same promise.
  let createInFlight: Promise<unknown> | null = null
  handleIpc(
    Channels.WORKSPACE_CREATE,
    (payload: {
      projectId: string
      name: string
      branchName: string
      sourceBranch: string
      repos?: Array<{ repoId: string; sourceBranch?: string }>
    }) => {
      if (createInFlight) {
        console.log('[ipc] WORKSPACE_CREATE: already in flight, returning existing promise')
        return createInFlight
      }
      createInFlight = createWorkspace(payload)
        .then((workspace) => {
          push(Channels.WORKSPACE_CREATED, workspace)
          return workspace
        })
        .finally(() => {
          createInFlight = null
        })
      return createInFlight
    }
  )

  handleIpc(Channels.WORKSPACE_OPEN, async (payload: { workspaceId: string }) => {
    const updated = await openWorkspace(payload.workspaceId)
    if (updated.status === 'broken') {
      push(Channels.WORKSPACE_BROKEN, { workspaceId: payload.workspaceId })
    } else {
      push(Channels.WORKSPACE_UPDATED, updated)
    }
    notifyWorkspaceVisited(payload.workspaceId)
  })

  handleIpc(
    Channels.WORKSPACE_CLOSE,
    async (payload: { workspaceId: string; removeFiles: boolean }) => {
      await closeWorkspace(payload.workspaceId, payload.removeFiles)
      push(Channels.WORKSPACE_CLOSED, { workspaceId: payload.workspaceId })
    }
  )

  handleIpc(Channels.WORKSPACE_REOPEN, async (payload: { workspaceId: string }) => {
    const updated = await reopenWorkspace(payload.workspaceId)
    push(Channels.WORKSPACE_UPDATED, updated)

    // Check if the reopened worktree has a setup script
    const workspace = await workspaceRepo.getById(payload.workspaceId)
    if (workspace) {
      const localPath = await projectRepo.getLocalPath(workspace.projectId)
      if (localPath) {
        const repos = await workspaceRepoRepo.getReposByWorkspace(payload.workspaceId)
        const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
        const repo = repos[0]
        if (repo) {
          const worktreePath = deriveWorktreePath(
            localPath,
            repo.name,
            workspace.sanitizedName,
            isMultiRepo
          )
          const setupPath = join(deriveRepoBraidDir(worktreePath), 'setup.sh')
          if (existsSync(setupPath)) {
            push(Channels.WORKSPACE_SETUP_AVAILABLE, { workspaceId: payload.workspaceId })
          }
        }
      }
    }
  })

  handleIpc(Channels.WORKSPACE_REPAIR, async (payload: { workspaceId: string }) => {
    const updated = await repairWorkspace(payload.workspaceId)
    push(Channels.WORKSPACE_UPDATED, updated)
  })

  let validateInFlight: Promise<void> | null = null
  handleIpc(Channels.WORKSPACE_VALIDATE_OPEN, () => {
    if (validateInFlight) {
      console.log('[ipc] WORKSPACE_VALIDATE_OPEN: already in flight, skipping duplicate')
      return validateInFlight
    }
    validateInFlight = validateOpenWorktrees()
      .then((brokenWorkspaceId) => {
        if (brokenWorkspaceId) {
          push(Channels.WORKSPACE_BROKEN, { workspaceId: brokenWorkspaceId })
        }
      })
      .finally(() => {
        validateInFlight = null
      })
    return validateInFlight
  })

  handleIpc(Channels.GIT_STATUS, async (payload: { workspaceId: string }) => {
    const workspace = await workspaceRepo.getById(payload.workspaceId)
    if (!workspace) return { changedFiles: 0 }

    const localPath = await projectRepo.getLocalPath(workspace.projectId)
    if (!localPath) return { changedFiles: 0 }

    const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
    const repos = await workspaceRepoRepo.getReposByWorkspace(payload.workspaceId)
    let changedFiles = 0

    for (const repo of repos) {
      try {
        const worktreePath = deriveWorktreePath(
          localPath,
          repo.name,
          workspace.sanitizedName,
          isMultiRepo
        )
        const status = await simpleGit(worktreePath).status()
        changedFiles += status.files.length
      } catch {
        // worktree may not exist on disk — not an error
      }
    }

    return { changedFiles }
  })

  handleIpc(Channels.WORKSPACE_GET_BRANCHES, async (payload: { projectId: string }) => {
    const { projectId } = payload

    const localPath = await projectRepo.getLocalPath(projectId)
    if (!localPath) return []

    const repos = await repositoryRepo.getByProject(projectId)
    const existingWorkspaces = await workspaceRepo.getByProject(projectId)
    const attachedBranches = new Set(existingWorkspaces.map((w) => w.branchName))

    const branchSet = new Set<string>()
    for (const repo of repos) {
      const repoPath = deriveRepoPath(localPath, repo.name)
      const branches = await listBranches(repoPath)
      for (const b of branches) branchSet.add(b)
    }

    return Array.from(branchSet).filter((b) => !attachedBranches.has(b))
  })

  handleIpc(Channels.GIT_BRANCHES, async (payload: { projectId: string }) => {
    const { projectId } = payload

    const localPath = await projectRepo.getLocalPath(projectId)
    if (!localPath) return []

    const repos = await repositoryRepo.getByProject(projectId)

    const branchSet = new Set<string>()
    for (const repo of repos) {
      const repoPath = deriveRepoPath(localPath, repo.name)
      const branches = await listBranches(repoPath)
      for (const b of branches) branchSet.add(b)
    }

    return Array.from(branchSet)
  })

  handleIpc(Channels.GIT_BRANCHES_PER_REPO, async (payload: { projectId: string }) => {
    const { projectId } = payload

    const localPath = await projectRepo.getLocalPath(projectId)
    if (!localPath) return []

    const repos = await repositoryRepo.getByProject(projectId)
    const result: Array<{ repoId: string; repoName: string; branches: string[] }> = []

    for (const repo of repos) {
      const repoPath = deriveRepoPath(localPath, repo.name)
      const branches = await listBranches(repoPath)
      result.push({ repoId: repo.id, repoName: repo.name, branches })
    }

    return result
  })

  handleIpc(Channels.WORKSPACE_GET_URL, (payload: { workspaceId: string }) => {
    return getVscodeUrl(payload.workspaceId)
  })

  handleIpc(
    Channels.WORKSPACE_TOGGLE_PIN,
    (payload: { workspaceId: string; isPinned: boolean }) => {
      updateWorkspaceLocalPinned(payload.workspaceId, payload.isPinned)
    }
  )

  handleIpc(
    Channels.WORKSPACE_UPDATE_LIFECYCLE_STATUS,
    async (payload: { workspaceId: string; lifecycleStatus: WorkspaceLifecycleStatus }) => {
      await workspaceRepo.updateLifecycleStatus(payload.workspaceId, payload.lifecycleStatus)
      const updated = await workspaceRepo.getById(payload.workspaceId)
      if (updated) {
        push(Channels.WORKSPACE_UPDATED, updated)
      }
    }
  )

  handleIpc(
    Channels.WORKSPACE_ADD_REPO,
    async (payload: { workspaceId: string; repoId: string }) => {
      const updated = await addRepoToWorkspace(payload.workspaceId, payload.repoId)
      push(Channels.WORKSPACE_REPO_ADDED, updated)
      return updated
    }
  )

  handleIpc(Channels.WORKSPACE_CHECK_SETUP, async (payload: { workspaceId: string }) => {
    const workspace = await workspaceRepo.getById(payload.workspaceId)
    if (!workspace) return { hasSetupScript: false, repoNames: [] }

    const localPath = await projectRepo.getLocalPath(workspace.projectId)
    if (!localPath) return { hasSetupScript: false, repoNames: [] }

    const repos = await workspaceRepoRepo.getReposByWorkspace(payload.workspaceId)
    const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)

    const repoNames: string[] = []
    for (const repo of repos) {
      const worktreePath = deriveWorktreePath(
        localPath,
        repo.name,
        workspace.sanitizedName,
        isMultiRepo
      )
      const setupPath = join(deriveRepoBraidDir(worktreePath), 'setup.sh')
      if (existsSync(setupPath)) {
        repoNames.push(repo.name)
      }
    }

    return { hasSetupScript: repoNames.length > 0, repoNames }
  })

  handleIpc(Channels.WORKSPACE_RUN_SETUP, async (payload: { workspaceId: string }) => {
    const workspace = await workspaceRepo.getById(payload.workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const localPath = await projectRepo.getLocalPath(workspace.projectId)
    if (!localPath) throw new Error('Project local path not found')

    const repos = await workspaceRepoRepo.getReposByWorkspace(payload.workspaceId)
    const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
    const env = getShellEnv()
    const shell = env.SHELL || process.env.SHELL || '/bin/zsh'

    // Run setup.sh in each repo's worktree that has one
    const outputs: string[] = []

    for (const repo of repos) {
      const worktreePath = deriveWorktreePath(
        localPath,
        repo.name,
        workspace.sanitizedName,
        isMultiRepo
      )
      const setupPath = join(deriveRepoBraidDir(worktreePath), 'setup.sh')

      if (!existsSync(setupPath)) continue

      const result = await new Promise<{ success: boolean; output: string }>((resolve) => {
        const chunks: string[] = []
        const proc = spawn(shell, ['-l', '-c', 'cd "$BRAID_CWD" && bash .braid/setup.sh'], {
          cwd: worktreePath,
          env: { ...env, BRAID_CWD: worktreePath }
        })

        proc.on('error', (err) => {
          resolve({ success: false, output: err.message })
        })
        proc.on('close', (code) => {
          resolve({ success: code === 0, output: chunks.join('') })
        })

        proc.stdout.on('data', (data: Buffer) => chunks.push(data.toString()))
        proc.stderr.on('data', (data: Buffer) => chunks.push(data.toString()))
      })

      if (repos.length > 1) {
        outputs.push(`── ${repo.name} ──\n${result.output}`)
      } else {
        outputs.push(result.output)
      }

      if (!result.success) {
        return { success: false, output: outputs.join('\n') }
      }
    }

    return { success: true, output: outputs.join('\n') }
  })

  handleIpc<{ text: string }, { name: string }>(
    Channels.WORKSPACE_SUGGEST_NAME,
    async (payload) => {
      // An empty name means "no suggestion" — the modal simply shows nothing
      // extra. Checking the capability first avoids a guaranteed-failing
      // request on every keystroke in local mode.
      if (!isCapabilityEnabled(Capability.NameSuggestion)) return { name: '' }

      try {
        const { data } = await apiClient.post<{ name: string }>('/workspaces/suggest-name', {
          text: payload.text
        })
        return data
      } catch {
        return { name: '' }
      }
    }
  )
}
