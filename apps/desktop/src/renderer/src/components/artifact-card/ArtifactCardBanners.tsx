import { AlertTriangle, Info } from 'lucide-react'

type ArtifactCardBannersProps = {
  newerVersionAvailable: boolean
  serverConflict: boolean
  notSharedYet: boolean
  error: string | undefined
  onPullLatest: () => void
  onDismissNewer: () => void
  onSaveAnyway: () => void
  onDismissConflict: () => void
  onSwitchToLocal?: () => void
}

export function ArtifactCardBanners({
  newerVersionAvailable,
  serverConflict,
  notSharedYet,
  error,
  onPullLatest,
  onDismissNewer,
  onSaveAnyway,
  onDismissConflict,
  onSwitchToLocal,
}: ArtifactCardBannersProps) {
  return (
    <>
      {/* Not shared yet — artifact exists locally but hasn't been saved to server */}
      {notSharedYet && (
        <div className="mx-3 mt-3 rounded-lg px-3 py-2.5 flex items-center gap-2.5 bg-surface border border-border-subtle select-text">
          <Info size={13} className="text-fg-tertiary shrink-0" />
          <div className="flex-1 text-[12px] text-fg-secondary">
            This artifact hasn't been shared yet. Save from Local mode to share with your team.
          </div>
          {onSwitchToLocal && (
            <button
              onClick={onSwitchToLocal}
              className="text-[11px] text-brand hover:text-brand/80 font-medium transition-colors shrink-0"
            >
              Switch to Local
            </button>
          )}
        </div>
      )}

      {/* Newer version available */}
      {newerVersionAvailable && !serverConflict && (
        <div className="mx-3 mt-3 rounded-lg px-3 py-2.5 flex items-center gap-2.5 bg-surface border border-border-subtle select-text">
          <AlertTriangle size={13} className="text-fg-tertiary shrink-0" />
          <div className="flex-1 text-[12px] text-fg-secondary">
            A newer shared version is available.
          </div>
          <button
            onClick={onPullLatest}
            className="text-[11px] text-brand hover:text-brand/80 font-medium transition-colors shrink-0"
          >
            Pull latest
          </button>
          <button
            onClick={onDismissNewer}
            className="text-[11px] text-fg-tertiary hover:text-fg-secondary transition-colors shrink-0"
          >
            &times;
          </button>
        </div>
      )}

      {/* Conflict detected on save attempt */}
      {serverConflict && (
        <div className="mx-3 mt-3 rounded-lg px-3 py-2.5 flex items-center gap-2.5 bg-surface border border-warning select-text">
          <AlertTriangle size={13} className="text-warning shrink-0" />
          <div className="flex-1 text-[12px] text-fg-secondary">
            Shared version has newer changes. Your save was paused to avoid overwriting.
          </div>
          <button
            onClick={onPullLatest}
            className="text-[11px] text-brand hover:text-brand/80 font-medium transition-colors shrink-0"
          >
            Pull latest
          </button>
          <button
            onClick={() => { onDismissConflict(); onSaveAnyway() }}
            className="text-[11px] text-fg-secondary hover:text-fg transition-colors shrink-0"
          >
            Save anyway
          </button>
        </div>
      )}

      {/* Error banner — each error on its own line */}
      {error && (
        <div className="mx-3 mt-3 rounded-lg px-3 py-2.5 flex items-start gap-2.5 bg-surface border border-error select-text cursor-text">
          <AlertTriangle size={13} className="text-error shrink-0 mt-0.5" />
          <div className="text-[12px] text-fg-secondary space-y-1 select-text">
            {error.split('\n').map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
