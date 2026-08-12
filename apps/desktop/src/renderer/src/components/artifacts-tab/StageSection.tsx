// ─── StageSection ────────────────────────────────────────────────────────────
// Visual divider between artifact groups in the scrollable view.
// Shows stage name + icon. Empty state when no artifacts in this stage.

import { Plus, Sparkles } from 'lucide-react'
import { getKindMeta } from '../artifact-card/constants'

interface StageSectionProps {
  kind: string
  isEmpty: boolean
  /** ref callback for scroll-spy intersection observer */
  sectionRef: (el: HTMLDivElement | null) => void
}

export function StageSection({ kind, isEmpty, sectionRef }: StageSectionProps) {
  const meta = getKindMeta(kind)
  const Icon = meta.Icon

  return (
    <div ref={sectionRef} data-stage={kind}>
      {/* Stage divider header */}
      <div className="flex items-center gap-2 px-1 pt-4 pb-2">
        <div className="flex items-center gap-1.5 text-fg-tertiary">
          <Icon size={12} />
          <span className="text-[11px] font-semibold uppercase tracking-wider">
            {meta.label}
          </span>
        </div>
        <div className="flex-1 border-t border-border-subtle" />
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="flex flex-col items-center gap-3 py-10 rounded-lg border border-dashed border-border-subtle bg-surface/50">
          <div className="flex items-center gap-1.5 text-fg-tertiary">
            <Icon size={16} className="opacity-40" />
          </div>
          <span className="text-[12px] text-fg-tertiary">
            No {meta.label.toLowerCase()} artifacts yet
          </span>
          <div className="flex items-center gap-2">
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-fg-secondary bg-surface border border-border rounded-md hover:border-border-strong transition-colors">
              <Plus size={11} />
              Create
            </button>
            <button className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium text-brand bg-brand/5 border border-brand/20 rounded-md hover:bg-brand/10 transition-colors">
              <Sparkles size={11} />
              Generate with AI
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
