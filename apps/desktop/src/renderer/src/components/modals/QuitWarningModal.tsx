import * as Dialog from '@radix-ui/react-dialog'
import { useUIStore } from '../../store/ui-store'
import { ipc } from '../../lib/ipc'
import { track } from '../../lib/analytics'

export function QuitWarningModal() {
  const { activeModal, modalContext, closeModal } = useUIStore()

  const open = activeModal === 'quit-warning'
  const activeTerminals = modalContext?.modal === 'quit-warning' ? modalContext.activeTerminals : []
  const uncommittedWorkspaces = modalContext?.modal === 'quit-warning' ? modalContext.uncommittedWorkspaces : []

  async function handleQuit() {
    track('app_closed')
    closeModal()
    await ipc.app.quit()
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) closeModal() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
          <Dialog.Content className="w-full max-w-[460px] bg-surface-deep border border-border rounded-2xl shadow-2xl overflow-hidden focus:outline-none">

            <div className="flex items-center px-6 pt-5 pb-5 border-b border-border">
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                Quit Braid?
              </Dialog.Title>
            </div>

            <div className="px-6 pt-5 pb-6 flex flex-col gap-4">
              <p className="text-[12px] text-fg-secondary">Active sessions and unsaved work:</p>

              {activeTerminals.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-semibold text-fg-tertiary uppercase tracking-wide">
                    Agent sessions still running
                  </p>
                  <div className="flex flex-col border border-border rounded-lg overflow-hidden">
                    {activeTerminals.map((t, i) => (
                      <div
                        key={i}
                        className={['flex items-center gap-3 px-3 py-2.5', i > 0 ? 'border-t border-border' : ''].join(' ')}
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-warning shrink-0" />
                        <span className="text-[12px] text-fg font-medium truncate">{t.workspaceName}</span>
                        <span className="text-[12px] text-fg-secondary truncate flex-1">{t.command}</span>
                        <span className="text-[11px] text-fg-tertiary shrink-0">{t.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {uncommittedWorkspaces.length > 0 && (
                <div className="flex flex-col gap-2">
                  <p className="text-[11px] font-semibold text-fg-tertiary uppercase tracking-wide">
                    Uncommitted changes
                  </p>
                  <div className="flex flex-col border border-border rounded-lg overflow-hidden">
                    {uncommittedWorkspaces.map((w, i) => (
                      <div
                        key={i}
                        className={['flex items-center gap-3 px-3 py-2.5', i > 0 ? 'border-t border-border' : ''].join(' ')}
                      >
                        <span className="text-[12px] text-fg font-medium truncate">{w.workspaceName}</span>
                        <span className="text-[12px] text-fg-secondary truncate flex-1">{w.repoName}</span>
                        <span className="text-[11px] text-fg-tertiary shrink-0">
                          {w.changedFiles} {w.changedFiles === 1 ? 'file' : 'files'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1 pt-1 border-t border-border-subtle">
                {activeTerminals.length > 0 && (
                  <p className="text-[12px] text-fg-secondary">
                    Quitting will interrupt active agent sessions.
                  </p>
                )}
                {uncommittedWorkspaces.length > 0 && (
                  <p className="text-[12px] text-fg-secondary">
                    Uncommitted changes will remain on disk.
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between px-6 py-4 border-t border-border">
              <button
                onClick={closeModal}
                className="text-[13px] text-fg-tertiary hover:text-fg-secondary transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleQuit}
                className="px-5 py-2 rounded-lg text-[13px] font-semibold bg-surface-hover border border-border-strong text-fg hover:bg-surface-active transition-colors"
              >
                Quit Anyway
              </button>
            </div>

          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
