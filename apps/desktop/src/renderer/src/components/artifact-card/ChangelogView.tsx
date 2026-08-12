import { AFFECTS_BADGE_STYLE } from '../../lib/artifact-constants'

type ChangelogViewProps = {
  entries: Array<Record<string, unknown>>
}

export function ChangelogView({ entries }: ChangelogViewProps) {
  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-[12px] text-fg-tertiary">
        No changes recorded yet.
      </div>
    )
  }

  return (
    <div className="px-4 py-3 flex flex-col gap-3">
      {entries.map((entry, i) => (
        <div key={i} className="flex gap-3">
          {/* Timeline line + dot */}
          <div className="flex flex-col items-center pt-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-fg-tertiary shrink-0" />
            {i < entries.length - 1 && (
              <div className="w-px flex-1 bg-border-subtle mt-1" />
            )}
          </div>

          {/* Entry content */}
          <div className="flex-1 pb-3">
            {/* Added */}
            {entry.added != null && (
              <div className="text-[12px] text-fg">
                <span className="text-success font-medium">Added:</span>{' '}
                {String(entry.added)}
              </div>
            )}

            {/* Removed */}
            {entry.removed != null && (
              <div className="mt-0.5 text-[12px] text-fg-secondary">
                <span className="text-fg-tertiary font-medium">Removed:</span>{' '}
                {String(entry.removed)}
              </div>
            )}

            {/* Why */}
            {entry.why != null && (
              <div className="mt-0.5 text-[12px] text-fg-secondary">
                <span className="text-fg-tertiary font-medium">Why:</span>{' '}
                {String(entry.why)}
              </div>
            )}

            {/* Affects (optional) */}
            {entry.affects != null && (
              <div className="mt-1">
                <span
                  className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${AFFECTS_BADGE_STYLE}`}
                >
                  Affects: {String(entry.affects)}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
