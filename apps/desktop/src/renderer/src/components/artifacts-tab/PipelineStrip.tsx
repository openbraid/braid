// ─── PipelineStrip ───────────────────────────────────────────────────────────
// Horizontal workflow visualization showing pipeline stages as connected pills.
// Pinned at top of the artifacts view.
//
// Full mode:  [Icon Label] ─── [Icon Label] ─── [Icon Label]  ⚙
// Compact:    [Icon] ── [Icon] ── [Icon]                      ⚙
//
// Connectors stretch to fill available space between pills.
// Click a stage → scrolls to that section + expands its artifact card.
// Click compact strip → expands to full mode.
// Settings button always pinned to the right edge.

import { Settings2 } from 'lucide-react'
import { getKindMeta } from '../artifact-card/constants'

export interface PipelineStage {
  kind: string
  hasContent: boolean
}

interface PipelineStripProps {
  stages: PipelineStage[]
  activeStageKind: string | null
  compact: boolean
  onStageClick: (kind: string) => void
  onConfigureClick: () => void
  onExpand: () => void
}

export function PipelineStrip({
  stages,
  activeStageKind,
  compact,
  onStageClick,
  onConfigureClick,
  onExpand,
}: PipelineStripProps) {
  if (stages.length === 0) return null

  function handleStageClick(kind: string) {
    if (compact) onExpand()
    onStageClick(kind)
  }

  function handleStripClick(e: React.MouseEvent) {
    if (compact && e.target === e.currentTarget) onExpand()
  }

  return (
    <div
      className={`
        shrink-0 flex items-center border-b border-border-subtle bg-surface
        transition-all duration-200 ease-out
        ${compact ? 'px-2 py-1.5' : 'px-4 py-3'}
      `}
      onClick={handleStripClick}
    >
      {/* Stages area — pills with stretchy connectors between them */}
      <div className="flex-1 min-w-0 flex items-center overflow-x-auto scrollbar-none">
        {stages.map((stage, i) => {
          const meta = getKindMeta(stage.kind)
          const isActive = stage.kind === activeStageKind
          const Icon = meta.Icon

          return (
            <div key={stage.kind} className="contents">
              {/* Connector line — stretches to fill space between pills */}
              {i > 0 && (
                <div
                  className={`
                    flex-1 border-t border-border-subtle
                    ${compact ? 'min-w-2 mx-0.5' : 'min-w-4 mx-1'}
                  `}
                />
              )}

              {/* Stage pill */}
              <button
                onClick={() => handleStageClick(stage.kind)}
                className={`
                  shrink-0 flex items-center gap-1.5 rounded-md transition-all duration-200
                  ${compact ? 'px-1.5 py-1' : 'px-2.5 py-1.5'}
                  ${isActive
                    ? 'bg-brand/10 text-brand border border-brand/20'
                    : stage.hasContent
                      ? 'bg-surface-secondary text-fg-secondary border border-border-subtle hover:border-border hover:text-fg'
                      : 'bg-transparent text-fg-tertiary border border-border-subtle border-dashed hover:bg-surface-secondary hover:border-border'
                  }
                `}
                title={meta.label}
              >
                <Icon size={compact ? 12 : 13} className="shrink-0" />
                {!compact && (
                  <span className="text-[11px] font-medium whitespace-nowrap">
                    {meta.label}
                  </span>
                )}
              </button>
            </div>
          )
        })}
      </div>

      {/* Configure button — always pinned right */}
      <div className="shrink-0 ml-2 pl-2 border-l border-border-subtle">
        <button
          onClick={onConfigureClick}
          className={`
            rounded-md text-fg-tertiary hover:text-fg-secondary hover:bg-surface-secondary
            transition-colors
            ${compact ? 'p-1' : 'p-1.5'}
          `}
          title="Configure pipeline stages"
        >
          <Settings2 size={compact ? 12 : 13} />
        </button>
      </div>
    </div>
  )
}
