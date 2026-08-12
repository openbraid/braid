import { Channels } from '../../../shared/ipc-types'
import type { WorkspaceTerminalEntry } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import {
  createTerminal,
  killTerminalById,
  renameTerminal,
  listTerminals,
  writeTerminalInput
} from '../../services/terminal'

export function registerTerminalHandlers(_push: (channel: string, payload: unknown) => void): void {
  handleIpc<{ workspaceId: string }, WorkspaceTerminalEntry>(
    Channels.TERMINAL_CREATE,
    (payload) => createTerminal(payload.workspaceId)
  )

  handleIpc<{ id: string }, void>(Channels.TERMINAL_KILL, (payload) => {
    killTerminalById(payload.id)
  })

  handleIpc<{ id: string; label: string }, void>(Channels.TERMINAL_RENAME, (payload) => {
    renameTerminal(payload.id, payload.label)
  })

  handleIpc<{ workspaceId: string }, WorkspaceTerminalEntry[]>(
    Channels.TERMINAL_LIST,
    (payload) => listTerminals(payload.workspaceId)
  )

  handleIpc<{ terminalId: string; data: string }, void>(
    Channels.TERMINAL_WRITE_INPUT,
    (payload) => {
      writeTerminalInput(payload.terminalId, payload.data)
    }
  )
}
