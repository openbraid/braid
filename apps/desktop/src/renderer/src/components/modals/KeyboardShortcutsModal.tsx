import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useUIStore } from '../../store/ui-store'
import { SHORTCUTS, SHORTCUT_CATEGORIES } from '../../../../shared/shortcuts'
import { KeyBadge } from '../ui/KeyBadge'

export function KeyboardShortcutsModal() {
  const { closeModal } = useUIStore()

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) closeModal() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[480px] bg-surface border border-border rounded-xl shadow-2xl flex flex-col outline-none">

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border-subtle shrink-0">
            <Dialog.Title className="text-[15px] font-semibold text-fg">
              Keyboard Shortcuts
            </Dialog.Title>
            <button
              onClick={closeModal}
              className="flex items-center justify-center w-7 h-7 rounded-md text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Shortcut categories */}
          <div className="px-5 py-4 flex flex-col gap-6">
            {SHORTCUT_CATEGORIES.map((cat) => {
              const defs = SHORTCUTS.filter((s) => s.category === cat.id)
              const categoryNote = defs.find((d) => d.note)?.note

              return (
                <div key={cat.id}>
                  {/* Category header */}
                  <div className="mb-3">
                    <h3 className="text-[11px] font-semibold text-fg-tertiary uppercase tracking-wider">
                      {cat.label}
                    </h3>
                    {categoryNote && (
                      <p className="text-[11px] text-fg-tertiary mt-0.5">{categoryNote}</p>
                    )}
                  </div>

                  {/* Rows */}
                  <div className="flex flex-col gap-1">
                    {defs.map((def) => (
                      <div key={def.id} className="flex items-center justify-between py-1.5">
                        <span className="text-[13px] text-fg-secondary">{def.label}</span>
                        <KeyBadge keys={def.keys} />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Footer note */}
          <div className="px-5 py-3 border-t border-border-subtle">
            <p className="text-[11px] text-fg-tertiary">
              <span className="text-brand mr-1">✦</span>
              All VS Code shortcuts work as-is within the editor
            </p>
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
