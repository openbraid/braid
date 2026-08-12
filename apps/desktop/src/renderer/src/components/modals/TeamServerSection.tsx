import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { ipc } from '../../lib/ipc'

/**
 * Connect the app to a self-hosted server, or disconnect back to local.
 *
 * The URL is verified against /health before anything is written: persisting a
 * server that cannot be reached means the next launch comes up empty with no
 * explanation. Nothing takes effect until restart, because the storage
 * bindings are resolved once at startup — the copy says so rather than
 * pretending the switch is live.
 */
export function TeamServerSection(): React.JSX.Element {
  const [serverUrl, setServerUrl] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  useEffect(() => {
    ipc.appMode.get().then((info) => setServerUrl(info.serverUrl ?? ''))
  }, [])

  async function handleSave(url: string | null): Promise<void> {
    setSaving(true)
    setResult(null)
    const res = await ipc.appMode.set(url, url ? token : null)
    setSaving(false)

    if (res.ok) {
      setResult({
        ok: true,
        message: url ? 'Connected.' : 'Disconnected.'
      })
      if (!url) {
        setServerUrl('')
        setToken('')
      }
    } else {
      setResult({ ok: false, message: res.error })
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-1 border-t border-border-subtle">
      <div>
        <span className="text-[13px] text-fg-secondary">Team server</span>
        <p className="text-[11px] text-fg-tertiary mt-0.5">
          Optional and experimental. Leave empty to keep everything on this machine.
        </p>
      </div>

      <input
        value={serverUrl}
        onChange={(e) => setServerUrl(e.target.value)}
        placeholder="http://localhost:3003"
        spellCheck={false}
        className="w-full px-2 py-1.5 rounded-md bg-surface border border-border text-[12px] text-fg placeholder:text-fg-tertiary focus:outline-none focus:border-brand/50"
      />

      <input
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Server token"
        type="password"
        spellCheck={false}
        className="w-full px-2 py-1.5 rounded-md bg-surface border border-border text-[12px] text-fg placeholder:text-fg-tertiary focus:outline-none focus:border-brand/50"
      />

      <div className="flex items-center gap-2">
        <button
          disabled={saving || !serverUrl.trim()}
          onClick={() => handleSave(serverUrl.trim())}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-brand text-white text-[12px] font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-brand/90 transition-colors"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Connect
        </button>

        <button
          disabled={saving}
          onClick={() => handleSave(null)}
          className="px-2.5 py-1 rounded-md border border-border text-[12px] text-fg-secondary hover:text-fg hover:bg-surface-hover disabled:opacity-40 transition-colors"
        >
          Use local
        </button>
      </div>

      {result && (
        <p
          className={`text-[11px] select-text cursor-text ${result.ok ? 'text-success' : 'text-error'}`}
        >
          {result.message}
        </p>
      )}

      {result?.ok && (
        <div className="flex items-start gap-2 p-2 rounded-md bg-surface-hover border border-border">
          <div className="flex-1">
            <p className="text-[11px] text-fg">Braid must restart to switch storage.</p>
            {/* Not automatic: quitting tears down the VS Code servers and every
                terminal, so a silent relaunch would kill a running agent
                mid-task. The user decides when that is acceptable. */}
            <p className="text-[11px] text-fg-tertiary mt-0.5">
              Any agents running in your terminals will be stopped.
            </p>
          </div>
          <button
            onClick={() => ipc.app.relaunch()}
            className="shrink-0 px-2.5 py-1 rounded-md bg-brand text-white text-[11px] font-medium hover:bg-brand/90 transition-colors"
          >
            Restart now
          </button>
        </div>
      )}

      <p className="text-[11px] text-fg-tertiary">
        Identity is taken from your git config. In shared-token mode the server trusts it, so only
        connect to a server you trust.
      </p>
    </div>
  )
}
