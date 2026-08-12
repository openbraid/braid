import { app, BrowserWindow, clipboard, dialog, ipcMain } from 'electron'
import { Channels } from '../../../shared/ipc-types'
import { handleIpc, handleIpcWithEvent } from '../handle-ipc'
import { getAppState, setAppState } from '../../lib/app-state'
import { setForceQuit } from '../../lib/quit-state'
import type { AppState } from '../../../shared/ipc-types'
import { registerProjectHandlers } from './projects'
import { registerWorkspaceHandlers } from './workspaces'
import { registerTerminalHandlers } from './terminals'
import { registerAuthHandlers } from './auth'
import { registerContributorHandlers } from './contributors'
import { registerArtifactHandlers } from './artifacts'
import { registerSessionHandlers } from './sessions'
import { registerScratchHandlers } from './scratch'
import { registerCapabilityHandlers } from './capabilities'
import { registerAppModeHandlers } from './app-mode'
import { registerTelemetryHandlers } from './telemetry'
import { broadcastThemeChange, getCurrentThemeKind } from '../../services/theme'

// ─── Push function factory ────────────────────────────────────────────────────
//
// This is the ONLY place in the main process that calls webContents.send().
// Services and queries never import BrowserWindow. Handlers receive push as a
// parameter so they remain testable without an Electron instance.

export function registerHandlers(mainWindow: BrowserWindow): void {
  function push(channel: string, payload: unknown): void {
    if (mainWindow.isDestroyed()) return
    mainWindow.webContents.send(channel, payload)
  }

  registerAuthHandlers(push)
  registerProjectHandlers(push)
  registerWorkspaceHandlers(push)
  registerTerminalHandlers(push)
  registerContributorHandlers()
  registerArtifactHandlers(push)
  registerSessionHandlers()
  registerScratchHandlers(push)
  registerCapabilityHandlers()
  registerAppModeHandlers()
  registerTelemetryHandlers()

  handleIpc(Channels.APP_STATE_GET, () => {
    return getAppState()
  })

  handleIpc(Channels.APP_STATE_SET, (patch: Partial<AppState>) => {
    const themeChanging = patch.themeKind && patch.themeKind !== getCurrentThemeKind()
    setAppState(patch)
    if (themeChanging && patch.themeKind) {
      broadcastThemeChange(patch.themeKind as 'dark' | 'light', 'app')
    }
  })

  handleIpc(Channels.APP_QUIT, () => {
    setForceQuit(true)
    app.quit()
  })

  // Used after changing storage mode, which is only read at startup.
  // setForceQuit skips the close-confirmation modal: the user has already
  // confirmed in Settings, and a second prompt on the way out reads as a bug.
  handleIpc(Channels.APP_RELAUNCH, () => {
    setForceQuit(true)
    app.relaunch()
    app.quit()
  })

  ipcMain.on('clipboard:write', (_event, text: string) => {
    clipboard.writeText(text)
  })

  handleIpcWithEvent(Channels.DIALOG_OPEN_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
}
