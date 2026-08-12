// ─── Git status poller ────────────────────────────────────────────────────────
//
// Runs one git status pass across ALL open workspaces every POLL_INTERVAL ms,
// then pushes GIT_STATUS_UPDATED for each workspace. A single centralized timer
// replaces the per-card setInterval that was running in the renderer.
//
// One pass = one project's open workspaces checked sequentially.
// Results are pushed immediately as they arrive — no batching delay.

import { BrowserWindow } from 'electron'
import simpleGit from 'simple-git'
import { Channels } from '../../../shared/ipc-types'
import { projectRepo, workspaceRepo, workspaceRepoRepo } from '../../repositories'
import { deriveWorktreePath } from '../../lib/derive-paths'
import { resolveIsMultiRepo } from '../worktree'

const POLL_INTERVAL_MS = 30_000

let mainWindow: BrowserWindow | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

async function pollAll(): Promise<void> {
  if (!mainWindow) return

  const openWorkspaces = (await workspaceRepo.getAll()).filter((ws) => ws.status === 'open')

  for (const workspace of openWorkspaces) {
    const localPath = await projectRepo.getLocalPath(workspace.projectId)
    if (!localPath) continue

    const repos = await workspaceRepoRepo.getReposByWorkspace(workspace.id)
    const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
    let changedFiles = 0

    for (const repo of repos) {
      try {
        const worktreePath = deriveWorktreePath(localPath, repo.name, workspace.sanitizedName, isMultiRepo)
        const status = await simpleGit(worktreePath).status()
        changedFiles += status.files.length
      } catch {
        // worktree may not be on disk — skip silently
      }
    }

    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send(Channels.GIT_STATUS_UPDATED, {
      workspaceId: workspace.id,
      changedFiles
    })
  }
}

export function startGitPoller(): void {
  if (pollTimer) return
  // Run once immediately so the UI has data before the first 30s interval
  pollAll().catch((err) => console.error('[git-poller] initial poll failed:', err))
  pollTimer = setInterval(() => {
    pollAll().catch((err) => console.error('[git-poller] poll failed:', err))
  }, POLL_INTERVAL_MS)
}

export function stopGitPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
