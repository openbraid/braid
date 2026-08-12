import { Channels } from '../../../shared/ipc-types'
import type { ScratchPage } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import {
  getPages,
  getPage,
  createPage,
  updatePageContent,
  updatePageTitle,
  deletePage,
  reorderPages,
  searchPages
} from '../../db/queries/scratch'
import { getAgentById } from '../../services/agents/registry'
import { shellEscape } from '../../lib/shell-escape'
import { getUser } from '../../services/auth'
import { requestTerminalWithCommand } from '../../services/terminal'
import { startRecording, stopRecording, isRecording } from '../../services/dictation'

async function requireUserId(): Promise<string> {
  const user = await getUser()
  if (!user) throw Object.assign(new Error('Not authenticated'), { code: 'NOT_AUTHENTICATED' })
  if (!user.backendUserId) throw Object.assign(new Error('Backend user ID not available — please sign out and sign back in'), { code: 'NOT_PROVISIONED' })
  return user.backendUserId
}

// Track whether Scratch owns the current dictation session
let scratchDictationActive = false

export function registerScratchHandlers(push: (channel: string, payload: unknown) => void): void {
  handleIpc<void, ScratchPage[]>(Channels.SCRATCH_GET_PAGES, async () => {
    const userId = await requireUserId()
    return getPages(userId)
  })

  handleIpc<{ id: string }, ScratchPage | null>(Channels.SCRATCH_GET_PAGE, (payload) => {
    return getPage(payload.id) ?? null
  })

  handleIpc<{ title?: string }, ScratchPage>(Channels.SCRATCH_CREATE_PAGE, async (payload) => {
    const userId = await requireUserId()
    return createPage(userId, payload.title ?? '')
  })

  handleIpc<{ id: string; content: string; textContent: string }, void>(
    Channels.SCRATCH_UPDATE_CONTENT,
    (payload) => {
      updatePageContent(payload.id, payload.content, payload.textContent)
    }
  )

  handleIpc<{ id: string; title: string }, void>(Channels.SCRATCH_UPDATE_TITLE, (payload) => {
    updatePageTitle(payload.id, payload.title)
  })

  handleIpc<{ id: string }, void>(Channels.SCRATCH_DELETE_PAGE, (payload) => {
    deletePage(payload.id)
  })

  handleIpc<{ orderedIds: string[] }, void>(Channels.SCRATCH_REORDER_PAGES, (payload) => {
    reorderPages(payload.orderedIds)
  })

  handleIpc<{ query: string }, ScratchPage[]>(Channels.SCRATCH_SEARCH, async (payload) => {
    const userId = await requireUserId()
    return searchPages(userId, payload.query)
  })

  handleIpc<{ agentId: string; prompt: string; workspaceId: string }, { success: boolean }>(
    Channels.SCRATCH_LAUNCH_AGENT,
    (payload) => {
      const agent = getAgentById(payload.agentId)
      if (!agent?.launchWithPrompt) {
        return { success: false }
      }
      const escaped = shellEscape(payload.prompt)
      const command = agent.launchWithPrompt(escaped)
      const sent = requestTerminalWithCommand(command, payload.workspaceId)
      return { success: sent }
    }
  )

  // ─── Dictation ──────────────────────────────────────────────────────────────

  handleIpc<void, { success: boolean; error?: string }>(
    Channels.SCRATCH_DICTATION_START,
    () => {
      // Refuse if any dictation is already active (terminal or Scratch)
      if (isRecording()) {
        return { success: false, error: 'Dictation is already active' }
      }

      scratchDictationActive = true

      startRecording((msg) => {
        // Guard: if Scratch dictation was stopped/cancelled, ignore late callbacks
        if (!scratchDictationActive) return

        if (msg.type === 'DICTATION.VOLUME') {
          push(Channels.SCRATCH_DICTATION_VOLUME, { levels: msg.levels as number[] })
        } else if (msg.type === 'DICTATION.RESULT') {
          scratchDictationActive = false
          push(Channels.SCRATCH_DICTATION_RESULT, { text: msg.text as string })
        } else if (msg.type === 'DICTATION.ERROR') {
          scratchDictationActive = false
          push(Channels.SCRATCH_DICTATION_ERROR, { error: msg.error as string })
        } else if (msg.type === 'DICTATION.STATUS') {
          push(Channels.SCRATCH_DICTATION_STATUS, { message: msg.message as string })
        }
      })

      return { success: true }
    }
  )

  handleIpc<{ cancel: boolean }, void>(Channels.SCRATCH_DICTATION_STOP, (payload) => {
    if (scratchDictationActive) {
      if (payload.cancel) {
        // Kill — discard any pending result
        scratchDictationActive = false
      }
      // Normal stop — scratchDictationActive stays true so RESULT flows through
      stopRecording()
    }
  })
}

