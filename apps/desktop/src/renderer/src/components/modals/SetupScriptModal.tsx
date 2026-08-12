import * as Dialog from '@radix-ui/react-dialog'
import { Copy, X } from 'lucide-react'
import { useUIStore } from '../../store/ui-store'
import { ipc } from '../../lib/ipc'
import { toast } from 'sonner'

export function SetupOutputModal() {
  const { activeModal, modalContext, closeModal } = useUIStore()

  const open = activeModal === 'setup-script'
  const output = modalContext?.modal === 'setup-script' ? modalContext.output : ''

  function handleCopy() {
    ipc.clipboard.copy(output)
    toast('Copied to clipboard')
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) closeModal() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
          <Dialog.Content className="w-full max-w-[640px] bg-surface-deep border border-border rounded-2xl shadow-2xl overflow-hidden focus:outline-none">

            <div className="flex items-center justify-between px-6 pt-5 pb-5 border-b border-border">
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                Setup Output
              </Dialog.Title>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11px] text-fg-tertiary hover:text-fg-secondary hover:bg-surface-hover transition-colors"
                >
                  <Copy size={12} />
                  Copy
                </button>
                <button onClick={closeModal} className="text-fg-tertiary hover:text-fg-secondary transition-colors">
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="p-4 max-h-[400px] overflow-y-auto select-text cursor-text">
              <pre className="font-mono text-[12px] text-fg-secondary whitespace-pre-wrap leading-relaxed select-text">{output}</pre>
            </div>

          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
