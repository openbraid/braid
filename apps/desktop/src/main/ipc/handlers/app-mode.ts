import { Channels } from '../../../shared/ipc-types'
import type { AppModeInfo } from '../../../shared/ipc-types'
import { handleIpc } from '../handle-ipc'
import { getConfig, setConfig, AppMode } from '../../lib/app-mode'

export function registerAppModeHandlers(): void {
  handleIpc(Channels.APP_MODE_GET, (): AppModeInfo => {
    const { mode, serverUrl } = getConfig()
    return { mode, serverUrl }
  })

  // Writes the config and reports whether the server actually answered. The
  // change only takes effect on restart — repository bindings are resolved once
  // at startup — so the caller is responsible for telling the user that.
  handleIpc(
    Channels.APP_MODE_SET,
    async (payload: { serverUrl: string | null; serverToken: string | null }) => {
      const serverUrl = payload.serverUrl?.trim() || null

      if (!serverUrl) {
        setConfig({ mode: AppMode.Local, serverUrl: null, serverToken: null })
        return { ok: true as const }
      }

      // Verify before persisting: saving a server the user cannot reach means
      // the next launch comes up broken with no obvious cause.
      //
      // A bare fetch rather than apiClient — /health is unauthenticated and
      // sits outside the /v1 prefix, so routing it through the configured
      // client would drag in its baseURL and auth interceptor.
      const base = serverUrl.replace(/\/+$/, '')
      try {
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) })

        if (res.status === 404) {
          // Something answered, but it is not this server. The usual cause on
          // macOS is an IPv4-only port publish: `localhost` resolves to ::1
          // first, where Docker replies 404 rather than refusing the connection.
          return {
            ok: false as const,
            error:
              `${base}/health returned 404 — something is listening, but it is not a Braid server. ` +
              `If the server is on this machine, try http://127.0.0.1:3003 instead of localhost.`
          }
        }
        if (!res.ok) {
          return { ok: false as const, error: `${base}/health returned ${res.status}` }
        }
      } catch (err) {
        return {
          ok: false as const,
          error: `Could not reach ${base} — ${err instanceof Error ? err.message : String(err)}`
        }
      }

      setConfig({ mode: AppMode.Team, serverUrl, serverToken: payload.serverToken?.trim() || null })
      return { ok: true as const }
    }
  )
}
