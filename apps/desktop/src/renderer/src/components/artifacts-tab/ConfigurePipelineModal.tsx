// ─── ConfigurePipelineModal ───────────────────────────────────────────────────
// Modal to configure which pipeline stages are visible and their order.
// Known stages can be toggled on/off. Custom stages can be added.
// Up/down buttons to reorder.

import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X, Plus, Trash2, ChevronUp, ChevronDown } from 'lucide-react'
import { KNOWN_KIND_ORDER, getKindMeta } from '../artifact-card/constants'

export interface PipelineConfig {
  stages: string[]
}

interface ConfigurePipelineModalProps {
  open: boolean
  onClose: () => void
  currentStages: string[]
  kindsWithContent: Set<string>
  onSave: (stages: string[]) => void
}

export function ConfigurePipelineModal({
  open,
  onClose,
  currentStages,
  kindsWithContent,
  onSave,
}: ConfigurePipelineModalProps) {
  const [stages, setStages] = useState<string[]>(currentStages)
  const [customInput, setCustomInput] = useState('')

  // Sync local state whenever the modal opens — picks up auto-detected
  // artifacts, external changes, etc.
  useEffect(() => {
    if (open) {
      setStages(currentStages)
      setCustomInput('')
    }
  }, [open, currentStages])

  // Known kinds not currently in the pipeline
  const availableKnown = KNOWN_KIND_ORDER.filter((k) => !stages.includes(k))

  function addStage(kind: string) {
    // RCA goes to the top (feeds back into the cycle)
    if (kind === 'RCA') {
      setStages((prev) => [kind, ...prev])
    } else {
      setStages((prev) => [...prev, kind])
    }
  }

  function removeStage(kind: string) {
    if (kindsWithContent.has(kind)) return
    setStages((prev) => prev.filter((s) => s !== kind))
  }

  function moveStage(index: number, direction: -1 | 1) {
    const newIndex = index + direction
    if (newIndex < 0 || newIndex >= stages.length) return
    setStages((prev) => {
      const next = [...prev]
      const [moved] = next.splice(index, 1)
      next.splice(newIndex, 0, moved)
      return next
    })
  }

  function addCustomStage() {
    const name = customInput.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')
    if (!name || stages.includes(name)) {
      setCustomInput('')
      return
    }
    setStages((prev) => [...prev, name])
    setCustomInput('')
  }

  function handleSave() {
    onSave(stages)
    onClose()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[400px] max-h-[70vh] bg-surface border border-border rounded-xl shadow-2xl flex flex-col outline-none">

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border-subtle shrink-0">
            <Dialog.Title className="text-[15px] font-semibold text-fg">
              Configure Pipeline
            </Dialog.Title>
            <button
              onClick={onClose}
              className="flex items-center justify-center w-7 h-7 rounded-md text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Stage list */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            <div className="flex flex-col gap-1">
              {stages.map((kind, i) => {
                const meta = getKindMeta(kind)
                const Icon = meta.Icon
                const hasContent = kindsWithContent.has(kind)

                return (
                  <div
                    key={kind}
                    className="flex items-center gap-2 px-2 py-2 rounded-md hover:bg-surface-hover group"
                  >
                    <Icon size={13} className="text-fg-secondary shrink-0" />
                    <span className="text-[12px] font-medium text-fg flex-1">{meta.label}</span>

                    {/* Reorder buttons */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => moveStage(i, -1)}
                        disabled={i === 0}
                        className="p-0.5 rounded text-fg-tertiary hover:text-fg disabled:opacity-20 transition-colors"
                      >
                        <ChevronUp size={12} />
                      </button>
                      <button
                        onClick={() => moveStage(i, 1)}
                        disabled={i === stages.length - 1}
                        className="p-0.5 rounded text-fg-tertiary hover:text-fg disabled:opacity-20 transition-colors"
                      >
                        <ChevronDown size={12} />
                      </button>
                    </div>

                    {/* Remove button (only if no content) */}
                    {!hasContent && (
                      <button
                        onClick={() => removeStage(kind)}
                        className="p-1 rounded text-fg-tertiary hover:text-error opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 size={11} />
                      </button>
                    )}
                    {hasContent && (
                      <div className="w-1.5 h-1.5 rounded-full bg-success shrink-0" title="Has artifacts" />
                    )}
                  </div>
                )
              })}
            </div>

            {/* Add known stages */}
            {availableKnown.length > 0 && (
              <div className="mt-4 pt-4 border-t border-border-subtle">
                <span className="text-[11px] font-medium text-fg-tertiary uppercase tracking-wider">
                  Add stage
                </span>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {availableKnown.map((kind) => {
                    const meta = getKindMeta(kind)
                    const Icon = meta.Icon
                    return (
                      <button
                        key={kind}
                        onClick={() => addStage(kind)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-fg-secondary bg-surface border border-border-subtle rounded-md hover:border-border hover:text-fg transition-colors"
                      >
                        <Icon size={11} />
                        {meta.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Add custom stage */}
            <div className="mt-4 pt-4 border-t border-border-subtle">
              <span className="text-[11px] font-medium text-fg-tertiary uppercase tracking-wider">
                Custom stage
              </span>
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="text"
                  value={customInput}
                  onChange={(e) => setCustomInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') addCustomStage() }}
                  placeholder="e.g. Compliance Review"
                  className="flex-1 h-8 px-3 text-[12px] text-fg bg-surface border border-border rounded-md outline-none focus:border-brand placeholder:text-fg-tertiary transition-colors"
                />
                <button
                  onClick={addCustomStage}
                  disabled={!customInput.trim()}
                  className="h-8 px-3 text-[11px] font-medium text-fg-secondary bg-surface border border-border rounded-md hover:border-border-strong transition-colors disabled:opacity-30"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border-subtle shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[12px] font-medium text-fg-secondary hover:text-fg transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-[12px] font-medium bg-fg text-fg-inverse rounded-md hover:opacity-90 transition-opacity"
            >
              Save
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
