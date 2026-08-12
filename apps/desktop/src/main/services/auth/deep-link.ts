import { app, BrowserWindow } from 'electron'
import path from 'path'
import { handleCallback, provisionUserInBackend, getLastProvider, clearSession } from './index'

const PROTOCOL = 'braid'

type AuthCompleteHandler = (result: { success: boolean; error?: string }) => void

// Buffer URLs that arrive before the handler is ready (macOS open-url can fire early)
let pendingUrl: string | null = null
let authCompleteHandler: AuthCompleteHandler | null = null

export function registerProtocol(): void {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [
      path.resolve(process.argv[1])
    ])
  } else {
    app.setAsDefaultProtocolClient(PROTOCOL)
  }

  // Start buffering open-url events immediately (before app.whenReady)
  app.on('open-url', (event, url) => {
    event.preventDefault()
    if (!url.startsWith(`${PROTOCOL}://`)) return

    if (authCompleteHandler) {
      processUrl(url)
    } else {
      pendingUrl = url
    }
  })
}

async function processUrl(url: string): Promise<void> {
  const parsed = new URL(url)

  if (parsed.host !== 'auth' || parsed.pathname !== '/callback') return

  const code = parsed.searchParams.get('code')
  const error = parsed.searchParams.get('error')

  if (error) {
    console.error('[auth] OAuth error:', error, parsed.searchParams.get('error_description'))
    authCompleteHandler?.({ success: false, error: 'Authentication failed. Please try again.' })
    return
  }

  if (!code) {
    console.error('[auth] No authorization code in callback')
    authCompleteHandler?.({ success: false, error: 'Authentication failed. Please try again.' })
    return
  }

  try {
    await handleCallback(code)
  } catch (err) {
    console.error('[auth] Callback failed:', err)
    authCompleteHandler?.({ success: false, error: 'Authentication failed. Please try again.' })
    return
  }

  // Provision user in backend — blocking, required
  const provisioned = await provisionUserInBackend(getLastProvider())
  if (!provisioned) {
    clearSession()
    authCompleteHandler?.({ success: false, error: 'Unable to connect. Please try again.' })
    return
  }

  authCompleteHandler?.({ success: true })
}

export function setupDeepLinkHandling(
  mainWindow: BrowserWindow,
  onAuthComplete: AuthCompleteHandler
): void {
  authCompleteHandler = onAuthComplete

  if (pendingUrl) {
    const url = pendingUrl
    pendingUrl = null
    processUrl(url)
  }

  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`))
    if (url) processUrl(url)

    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}
