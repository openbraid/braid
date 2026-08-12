import { Channels } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import {
  scanFolder,
  createProject,
  deleteProject,
  getProjects,
  getSetupStatus,
  setupProjectLocally
} from '../../services/project'
import { refreshProjectMonitoredCommands } from '../../services/terminal'
import { detectInstalledAgents, getAgentList } from '../../services/agents/registry'
import { projectRepo, instructionRepo } from '../../repositories'

type PushFn = (channel: string, payload: unknown) => void

let createInFlight: Promise<unknown> | null = null

export function registerProjectHandlers(push: PushFn): void {
  handleIpc(Channels.PROJECT_LIST, async () => {
    return getProjects()
  })

  handleIpc(Channels.PROJECT_SCAN_FOLDER, (payload: { localPath: string }) => {
    return scanFolder(payload.localPath)
  })

  handleIpc(
    Channels.PROJECT_CREATE,
    (payload: {
      name: string
      localPath: string
      repos: Array<{ name: string; remoteUrl: string }>
    }) => {
      if (createInFlight) {
        console.log('[ipc] PROJECT_CREATE: already in flight, returning existing promise')
        return createInFlight
      }
      createInFlight = createProject(
        payload.name,
        payload.localPath,
        payload.repos,
        (label, status, detail) => {
          push(Channels.PROJECT_CREATE_PROGRESS, { label, status, detail })
        }
      )
        .then(async (project) => {
          // Auto-detect installed agents and save as selected (best-effort).
          // This ensures workspace context injection works without the user
          // needing to visit the Settings tab first.
          try {
            const detected = await detectInstalledAgents()
            if (detected.length > 0) {
              await projectRepo.updateSettings(project.id, { selectedAgents: detected })
            }
          } catch {
            /* non-fatal */
          }

          push(Channels.PROJECT_CREATED, project)
          return project
        })
        .finally(() => {
          createInFlight = null
        })
      return createInFlight
    }
  )

  // ─── Project setup (invited / recovered projects) ──────────────────────

  handleIpc(Channels.PROJECT_GET_SETUP_STATUS, (payload: { projectId: string }) =>
    getSetupStatus(payload.projectId)
  )

  // Deduplicated per projectId — accidental double-clicks return the same promise.
  const setupInFlight = new Map<string, Promise<unknown>>()
  handleIpc(
    Channels.PROJECT_SETUP_LOCALLY,
    (payload: { projectId: string; parentFolder: string }) => {
      const existing = setupInFlight.get(payload.projectId)
      if (existing) {
        console.log(`[ipc] PROJECT_SETUP_LOCALLY: already in flight for ${payload.projectId}`)
        return existing
      }
      const promise = setupProjectLocally(
        payload.projectId,
        payload.parentFolder,
        (label, status, detail) => {
          push(Channels.PROJECT_SETUP_PROGRESS, { label, status, detail })
        }
      )
        .then((project) => {
          push(Channels.PROJECT_UPDATED, project)
          return project
        })
        .finally(() => {
          setupInFlight.delete(payload.projectId)
        })
      setupInFlight.set(payload.projectId, promise)
      return promise
    }
  )

  // ─── Project delete ────────────────────────────────────────────────────

  // Deduplicated per projectId — accidental double-clicks return the same promise.
  const deleteInFlight = new Map<string, Promise<{ id: string; name: string }>>()
  handleIpc(Channels.PROJECT_DELETE, (payload: { projectId: string }) => {
    const existing = deleteInFlight.get(payload.projectId)
    if (existing) return existing
    const promise = deleteProject(payload.projectId)
      .then((result) => {
        push(Channels.PROJECT_DELETED, { projectId: result.id, name: result.name })
        return result
      })
      .finally(() => {
        deleteInFlight.delete(payload.projectId)
      })
    deleteInFlight.set(payload.projectId, promise)
    return promise
  })

  // ─── Project Settings ──────────────────────────────────────────────────

  handleIpc(Channels.PROJECT_GET_SETTINGS, async (payload: { projectId: string }) => {
    return projectRepo.getSettings(payload.projectId)
  })

  handleIpc(
    Channels.PROJECT_UPDATE_SETTINGS,
    async (payload: {
      projectId: string
      artifactsEnabled?: boolean
      selectedAgents?: string[]
    }) => {
      return projectRepo.updateSettings(payload.projectId, {
        artifactsEnabled: payload.artifactsEnabled,
        selectedAgents: payload.selectedAgents
      })
    }
  )

  // ─── Agent Detection ──────────────────────────────────────────────────

  handleIpc(Channels.AGENTS_DETECT, async () => {
    return detectInstalledAgents()
  })

  handleIpc(Channels.AGENTS_LIST, () => {
    return getAgentList()
  })

  // ─── Instruction ──────────────────────────────────────────────────────

  handleIpc(Channels.INSTRUCTION_GET_AGENT, async () => {
    const data = await instructionRepo.getAgentInstructions()
    return data
  })

  // ─── Monitored Commands ───────────────────────────────────────────────

  handleIpc(Channels.PROJECT_GET_MONITORED_COMMANDS, async (payload: { projectId: string }) => {
    return projectRepo.getMonitoredCommands(payload.projectId)
  })

  handleIpc(
    Channels.PROJECT_ADD_MONITORED_COMMAND,
    async (payload: { projectId: string; command: string }) => {
      await projectRepo.addMonitoredCommand(payload.projectId, payload.command)
      refreshProjectMonitoredCommands()
    }
  )

  handleIpc(
    Channels.PROJECT_REMOVE_MONITORED_COMMAND,
    async (payload: { projectId: string; command: string }) => {
      await projectRepo.removeMonitoredCommand(payload.projectId, payload.command)
      refreshProjectMonitoredCommands()
    }
  )
}
