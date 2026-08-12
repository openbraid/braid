import { shell } from 'electron'
import { Channels } from '../../../shared/ipc-types'
import type { AuthProvider } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import {
  getSignInUrl,
  getUser,
  getAccessToken,
  clearSession,
} from '../../services/auth'
import { stopAllServers } from '../../services/vscode-server'
import { stopAllTerminalServers, clearAllState as clearTerminalState } from '../../services/terminal'
import { stopGitPoller } from '../../services/git-poller'

type PushFn = (channel: string, payload: unknown) => void

export function registerAuthHandlers(push: PushFn): void {
  handleIpc(Channels.AUTH_SIGN_IN, async (payload: { provider: AuthProvider }) => {
    try {
      const url = await getSignInUrl(payload.provider)
      await shell.openExternal(url)
      return { success: true }
    } catch (error) {
      console.error('[auth] Sign in failed:', error)
      return { success: false, error: String(error) }
    }
  })

  handleIpc(Channels.AUTH_SIGN_OUT, async () => {
    try {
      // 1. Stop VS Code servers (kills child processes)
      await stopAllServers()

      // 2. Stop terminal servers and clear in-memory state
      await stopAllTerminalServers()
      clearTerminalState()

      // 3. Stop git status polling
      stopGitPoller()

      // 4. Clear auth session (JWT + refresh token)
      clearSession()

      // 5. Notify renderer
      push(Channels.AUTH_CHANGED, { user: null })

      return { success: true }
    } catch (error) {
      console.error('[auth] Sign out failed:', error)
      // Even on partial failure, clear session and notify renderer
      clearSession()
      push(Channels.AUTH_CHANGED, { user: null })
      return { success: false, error: String(error) }
    }
  })

  handleIpc(Channels.AUTH_GET_USER, async () => {
    try {
      return await getUser()
    } catch (error) {
      console.error('[auth] Get user failed:', error)
      return null
    }
  })

  handleIpc(Channels.AUTH_GET_TOKEN, () => {
    return getAccessToken()
  })
}

export function notifyAuthChange(push: PushFn, user: unknown): void {
  push(Channels.AUTH_CHANGED, { user })
}
