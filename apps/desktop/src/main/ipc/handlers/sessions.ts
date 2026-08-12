import { Channels } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import { listSessions, renameSession } from '../../services/sessions'

export function registerSessionHandlers(): void {
  handleIpc(Channels.SESSION_LIST, (payload: { workspaceId: string }) => {
    return listSessions(payload.workspaceId)
  })

  handleIpc(Channels.SESSION_RENAME, (payload: { sessionId: string; agent: string; name: string }) => {
    renameSession(payload.sessionId, payload.agent, payload.name)
  })
}
