import {
  app,
  shell,
  BrowserWindow,
  Menu,
  powerMonitor,
  session,
  dialog,
  nativeImage
} from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerHandlers } from './ipc/handlers/app'
import { stopAllServers } from './services/vscode-server'
import { hydrateWorktreeMap } from './services/workspace'
import {
  setMainWindow as setTerminalMainWindow,
  stopAllTerminalServers,
  refreshProjectMonitoredCommands
} from './services/terminal'
import {
  setMainWindow as setGitPollerMainWindow,
  startGitPoller,
  stopGitPoller
} from './services/git-poller'
import {
  disposeDictation,
  initializeDictation,
  getAudioCaptureWebContentsId
} from './services/dictation'
import { setThemeMainWindow } from './services/theme'
import { registerProtocol, setupDeepLinkHandling } from './services/auth/deep-link'
import { autoUpdater } from 'electron-updater'
import { getUser } from './services/auth'
import { Channels } from '../shared/ipc-types'
import { setAuthChangePush } from './lib/api-client'
import { getForceQuit, setForceQuit } from './lib/quit-state'
import { resolveShellEnv } from './lib/shell-env'

let mainWindow: BrowserWindow | null = null

// Register custom protocol for auth deep links — must happen before app.whenReady()
registerProtocol()

// Single instance lock — quit immediately if another instance is already running.
// Skip in dev mode so the dev server can run alongside a packaged app.
const gotLock = is.dev ? true : app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      webviewTag: true,
      contextIsolation: true
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow!.maximize()
    mainWindow!.show()
  })

  mainWindow.on('close', (e) => {
    if (getForceQuit()) return

    e.preventDefault()

    dialog
      .showMessageBox(mainWindow!, {
        type: 'question',
        title: 'Quit Braid',
        message: 'Are you sure you want to quit?',
        detail: 'Active sessions and VS Code servers will be stopped.',
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      })
      .then(({ response }) => {
        if (response === 0) {
          setForceQuit(true)
          app.quit()
        }
      })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const url = details.url
    if (url.startsWith('https://') || url.startsWith('http://localhost')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function buildMenu(): void {
  const viewMenuItems: Electron.MenuItemConstructorOptions[] = []
  if (is.dev) {
    viewMenuItems.push({ role: 'toggleDevTools', label: 'Toggle Developer Tools' })
  }

  // Helper: push a shortcut event to the renderer via IPC.
  // Click handlers close over the module-level mainWindow which is set by createWindow()
  // before any user interaction occurs.
  function triggerShortcut(shortcutId: string): void {
    mainWindow?.webContents.send(Channels.SHORTCUT_TRIGGERED, { shortcutId })
  }

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Braid',
      submenu: [
        { label: 'About Braid', role: 'about' },
        { type: 'separator' },
        // Window-wide keyboard accelerators — fire at the Chromium browser level
        // before any renderer or webview processes input, so they work regardless
        // of whether chrome or VS Code webview has focus.
        {
          label: 'Next Tab',
          accelerator: 'Ctrl+Shift+.',
          visible: false,
          click: () => triggerShortcut('workspace.next-tab')
        },
        {
          label: 'Previous Tab',
          accelerator: 'Ctrl+Shift+,',
          visible: false,
          click: () => triggerShortcut('workspace.prev-tab')
        },
        {
          label: 'Close Workspace',
          accelerator: 'Ctrl+Shift+W',
          visible: false,
          click: () => triggerShortcut('workspace.close')
        },
        {
          label: 'New Workspace',
          accelerator: 'Ctrl+Shift+N',
          visible: false,
          click: () => triggerShortcut('workspace.new')
        },
        {
          label: 'Workspace List',
          accelerator: 'Ctrl+Shift+O',
          visible: false,
          click: () => triggerShortcut('workspace.list')
        },
        {
          label: 'Toggle Scratch',
          accelerator: 'Ctrl+Shift+S',
          visible: false,
          click: () => triggerShortcut('scratch.toggle')
        },
        { type: 'separator' },
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
    },
    ...(viewMenuItems.length > 0 ? [{ label: 'View', submenu: viewMenuItems }] : [])
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('dev.braid.app')

  // Set dock icon explicitly so it shows the correct logo in dev mode
  if (process.platform === 'darwin') {
    const iconPath = join(__dirname, '../../build/icon.png')
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) app.dock?.setIcon(icon)
  }

  // Pre-resolve the user's login shell environment so PATH includes
  // homebrew, nvm, etc. for agent detection and setup script execution.
  resolveShellEnv().catch(() => {})

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Grant microphone access only to the audio capture window.
  // Other webContents (including webviews) are denied media permissions.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      const audioCaptureId = getAudioCaptureWebContentsId()
      callback(audioCaptureId !== null && webContents?.id === audioCaptureId)
    } else {
      callback(false)
    }
  })
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media') {
      const audioCaptureId = getAudioCaptureWebContentsId()
      return audioCaptureId !== null && webContents?.id === audioCaptureId
    }
    return false
  })

  buildMenu()
  createWindow()

  // ── Intercept global shortcuts inside <webview> guest processes ──────────
  // Electron menu accelerators don't reliably fire when a <webview> has focus
  // because the guest process can consume key events first. Listen on every
  // new webContents (including webview guests) and forward matching shortcuts
  // to the renderer before the guest page sees them.
  app.on('web-contents-created', (_event, contents) => {
    // Only intercept in webview guests — the main renderer already gets
    // shortcuts via Electron menu accelerators. Attaching to both would
    // cause double-fire (advance then advance again on a single keypress).
    if (contents.getType() !== 'webview') return

    contents.on('before-input-event', (event, input) => {
      if (!input.control || !input.shift) return
      const key = input.key.toLowerCase()
      if (key === '.' || key === '>') {
        event.preventDefault()
        mainWindow?.webContents.send(Channels.SHORTCUT_TRIGGERED, {
          shortcutId: 'workspace.next-tab'
        })
      } else if (key === ',' || key === '<') {
        event.preventDefault()
        mainWindow?.webContents.send(Channels.SHORTCUT_TRIGGERED, {
          shortcutId: 'workspace.prev-tab'
        })
      } else if (key === 'w') {
        event.preventDefault()
        mainWindow?.webContents.send(Channels.SHORTCUT_TRIGGERED, { shortcutId: 'workspace.close' })
      }
    })
  })

  // Terminal service still needs the window ref for pushing terminal events
  setTerminalMainWindow(mainWindow!)
  setThemeMainWindow(mainWindow!)

  // Git poller needs the window ref to push GIT_STATUS_UPDATED events
  setGitPollerMainWindow(mainWindow!)

  // All IPC push now flows through one push function owned by registerHandlers
  registerHandlers(mainWindow!)

  // Wire API client 401 handler to push AUTH_CHANGED to renderer when
  // refresh token is permanently rejected (not on transient network errors).
  setAuthChangePush(() => {
    mainWindow?.webContents.send(Channels.AUTH_CHANGED, { user: null })
  })

  // Proactively refresh token when system resumes from sleep.
  // This ensures the next API call already has a valid token instead of
  // discovering expiry on the first request and making the user wait.
  powerMonitor.on('resume', () => {
    getUser().catch(() => {
      // Network may not be ready yet on resume — that's fine,
      // getUser() preserves session on network errors. Next API
      // call will retry refresh via the 401 interceptor.
    })
  })

  // Auth: deep link handling for OAuth callbacks (braid://auth/callback)
  setupDeepLinkHandling(mainWindow!, async (result) => {
    if (result.success) {
      const user = await getUser()
      mainWindow?.webContents.send(Channels.AUTH_CHANGED, { user })

      // First login in this session — run API-dependent tasks now that we have a JWT
      hydrateWorktreeMap().catch((err) => {
        console.error('[main] hydrateWorktreeMap failed:', err)
      })
      startGitPoller()
      refreshProjectMonitoredCommands()
    } else {
      mainWindow?.webContents.send(Channels.AUTH_CHANGED, { user: null, error: result.error })
    }
  })

  // Auth: check for existing session and push to renderer once it finishes loading.
  // API-dependent startup tasks (hydrate, git poller) only run if the user is authenticated.
  getUser()
    .then((user) => {
      if (user) {
        mainWindow?.webContents.once('did-finish-load', () => {
          mainWindow?.webContents.send(Channels.AUTH_CHANGED, { user })
        })

        // These require a valid JWT — only run when authenticated
        hydrateWorktreeMap().catch((err) => {
          console.error('[main] hydrateWorktreeMap failed:', err)
        })
        startGitPoller()
        refreshProjectMonitoredCommands()
      }
    })
    .catch((err) => console.error('[auth] Initial auth check failed:', err))

  // Download whisper model (if needed) and pre-warm audio capture window.
  // Both run silently in the background — no UI, no blocking.
  initializeDictation()

  // Auto-update: check GitHub Releases for new versions.
  // In dev mode, skip — autoUpdater errors without a packaged app.
  if (!is.dev) {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.on('update-available', (info) => {
      console.log('[updater] Update available:', info.version)
    })

    autoUpdater.on('update-downloaded', (info) => {
      dialog
        .showMessageBox({
          type: 'info',
          title: 'Update Ready',
          message: `Version ${info.version} has been downloaded. Restart to apply the update.`,
          buttons: ['Restart Now', 'Later']
        })
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall()
        })
    })

    autoUpdater.on('error', (err) => {
      console.error('[updater] Error:', err.message)
    })

    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] Check failed:', err.message)
    })
  }

  app.on('before-quit', (e) => {
    if (!getForceQuit()) {
      // Let the close interceptor handle the warning modal
      e.preventDefault()
      mainWindow?.close()
      return
    }
    stopGitPoller()
    disposeDictation()
    stopAllServers()
    stopAllTerminalServers().catch(() => {})
  })

  app.on('activate', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
