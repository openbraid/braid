import type { ArtifactKind } from '../../../shared/ipc-types'
import { Capability, Channels } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import { assertCapability } from '../../services/capabilities'
import { getConfig, getServerUrl } from '../../lib/app-mode'
import { getLocalUser } from '../../lib/local-user'
import { projectRepo, workspaceRepo } from '../../repositories'
import { deriveArtifactDir } from '../../lib/derive-paths'
import { resolveIsMultiRepo } from '../../services/worktree'
import {
  listArtifactFiles,
  readArtifactFile,
  writeArtifactFile,
  initArtifactFolder
} from '../../services/artifact'
import { startWatching } from '../../services/artifact/file-watcher'
import {
  listArtifactsFromServer,
  getArtifactFromServer,
  saveArtifactToServer,
  updateArtifactStatusOnServer
} from '../../services/artifact/api-client'
import { getAccessToken } from '../../services/auth'
import {
  getArtifactSyncVersion,
  getArtifactBaseYaml,
  setArtifactSyncState,
  setArtifactSyncVersion
} from '../../lib/sync-state'

type PushFn = (channel: string, payload: unknown) => void

export function registerArtifactHandlers(push: PushFn): void {
  handleIpc(Channels.ARTIFACT_LIST, async (payload: { workspaceId: string }) => {
    const braidDir = await resolveBraidDir(payload.workspaceId)
    if (!braidDir) return { artifacts: [], errors: [], duplicateKinds: [] }
    return listArtifactFiles(braidDir)
  })

  handleIpc(
    Channels.ARTIFACT_READ,
    async (payload: { workspaceId: string; kind: ArtifactKind }) => {
      const braidDir = await resolveBraidDir(payload.workspaceId)
      if (!braidDir) return null
      return readArtifactFile(braidDir, payload.kind)
    }
  )

  handleIpc(
    Channels.ARTIFACT_WRITE,
    async (payload: { workspaceId: string; kind: ArtifactKind; yamlContent: string }) => {
      const braidDir = await resolveBraidDir(payload.workspaceId)
      if (!braidDir) return { success: false, error: 'Could not resolve artifact directory' }
      return writeArtifactFile(braidDir, payload.kind, payload.yamlContent)
    }
  )

  handleIpc(Channels.ARTIFACT_FOLDER_INIT, async (payload: { workspaceId: string }) => {
    const braidDir = await resolveBraidDir(payload.workspaceId)
    if (!braidDir) {
      return { braidDir: '', seededArtifacts: [] }
    }

    const result = initArtifactFolder(braidDir)

    // Start watching for external changes (idempotent — won't double-watch)
    startWatching(braidDir, payload.workspaceId, push)

    return result
  })

  // ─── Server-backed artifact endpoints ────────────────────────────────────

  handleIpc(Channels.ARTIFACT_SERVER_LIST, async (payload: { workspaceId: string }) => {
    assertCapability(Capability.SharedArtifacts)

    return listArtifactsFromServer(payload.workspaceId)
  })

  handleIpc(
    Channels.ARTIFACT_SERVER_GET,
    async (payload: { workspaceId: string; kind: string }) => {
      assertCapability(Capability.SharedArtifacts)

      return getArtifactFromServer(payload.workspaceId, payload.kind)
    }
  )

  handleIpc(
    Channels.ARTIFACT_SERVER_SAVE,
    async (payload: {
      workspaceId: string
      kind: string
      yamlContent: string
      title?: string
      expectedVersion?: number
      yjsState?: string
    }) => {
      assertCapability(Capability.SharedArtifacts)

      const result = await saveArtifactToServer(
        payload.workspaceId,
        payload.kind,
        payload.yamlContent,
        {
          title: payload.title,
          expectedVersion: payload.expectedVersion,
          yjsState: payload.yjsState
        }
      )

      return result
    }
  )

  handleIpc(
    Channels.ARTIFACT_SERVER_UPDATE_STATUS,
    async (payload: { workspaceId: string; kind: string; status: string }) => {
      assertCapability(Capability.SharedArtifacts)

      return updateArtifactStatusOnServer(payload.workspaceId, payload.kind, payload.status)
    }
  )

  // Sync: fetch from server + write to local file in one atomic operation
  handleIpc(
    Channels.ARTIFACT_SERVER_SYNC,
    async (payload: { workspaceId: string; kind: string }) => {
      assertCapability(Capability.SharedArtifacts)

      const result = await getArtifactFromServer(payload.workspaceId, payload.kind)

      // Write server content to local file
      const braidDir = await resolveBraidDir(payload.workspaceId)
      if (braidDir) {
        writeArtifactFile(braidDir, payload.kind as ArtifactKind, result.yamlContent)
      }

      return result
    }
  )

  handleIpc(
    Channels.ARTIFACT_GET_COLLAB_URL,
    async (payload: { workspaceId: string; kind: string }) => {
      assertCapability(Capability.LiveEditing)

      // Derived from the configured server rather than a baked-in host: a
      // self-hoster's collaboration traffic must go where they pointed us.
      // http(s) → ws(s) so a plain-HTTP LAN or Tailscale server works too.
      const serverUrl = getServerUrl()
      if (!serverUrl) throw new Error('No server configured')

      const wsBase = serverUrl.replace(/^http/, 'ws').replace(/\/+$/, '')
      const url = new URL(`${wsBase}/collaboration/${payload.workspaceId}/${payload.kind}`)

      // Shared-token mode identifies the caller by header, but a WebSocket
      // handshake carries no custom headers — so the same values go on the
      // query string, which is what the server reads for socket connections.
      // Without them the socket authenticates as nobody and the document never
      // loads, while REST keeps working, which looks like "shared is empty".
      if (getConfig().serverToken) {
        const user = getLocalUser()
        url.searchParams.set('x-user-email', user.email)
        if (user.displayName) url.searchParams.set('x-user-name', user.displayName)
      }

      return {
        url: url.toString(),
        token: getAccessToken() ?? ''
      }
    }
  )

  // ─── Sync version persistence ──────────────────────────────────────────────

  handleIpc(
    Channels.ARTIFACT_GET_SYNC_VERSION,
    async (payload: { workspaceId: string; kind: string }) => {
      const version = getArtifactSyncVersion(payload.workspaceId, payload.kind)
      if (version === null) return null
      const yamlContent = getArtifactBaseYaml(payload.workspaceId, payload.kind)
      return { version, yamlContent }
    }
  )

  handleIpc(
    Channels.ARTIFACT_SET_SYNC_VERSION,
    async (payload: {
      workspaceId: string
      kind: string
      version: number
      yamlContent?: string
    }) => {
      if (payload.yamlContent !== undefined) {
        setArtifactSyncState(
          payload.workspaceId,
          payload.kind,
          payload.version,
          payload.yamlContent
        )
      } else {
        setArtifactSyncVersion(payload.workspaceId, payload.kind, payload.version)
      }
    }
  )
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Resolves the artifact directory for a workspace.
 * Single-repo: <worktree>/.braid/<branchName>/
 * Multi-repo:  <workspaceFolder>/.braid/
 *
 * No longer depends on repos[0] — path is derived from project path + branch + isMultiRepo.
 */
async function resolveBraidDir(workspaceId: string): Promise<string | null> {
  const workspace = await workspaceRepo.getById(workspaceId)
  if (!workspace) {
    console.error(`[artifact] Workspace not found: ${workspaceId}`)
    return null
  }

  const localPath = await projectRepo.getLocalPath(workspace.projectId)
  if (!localPath) {
    console.error(`[artifact] No local path for project: ${workspace.projectId}`)
    return null
  }

  const isMultiRepo = await resolveIsMultiRepo(workspace.projectId)
  return deriveArtifactDir(localPath, workspace.sanitizedName, isMultiRepo)
}
