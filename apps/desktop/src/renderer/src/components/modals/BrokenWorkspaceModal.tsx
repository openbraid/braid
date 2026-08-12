import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { useUIStore } from '../../store/ui-store'
import { useWorkspaceStore } from '../../store/workspace-store'
import { ipc } from '../../lib/ipc'

export function BrokenWorkspaceModal() {
  const { activeModal, modalContext, closeModal } = useUIStore()
  const workspaces = useWorkspaceStore((s) => s.workspaces)

  const workspaceId = modalContext?.modal === 'broken-workspace' ? modalContext.workspaceId : undefined
  const workspace = workspaces.find((ws) => ws.id === workspaceId)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = activeModal === 'broken-workspace'

  if (!workspace) return null

  async function handleRecreate() {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      await ipc.workspaces.repair(workspaceId)
      closeModal()
    } catch (err) {
      setError((err as { message?: string })?.message ?? 'Failed to recreate workspace')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen && !loading) closeModal() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <Dialog.Content className="w-full max-w-[420px] bg-surface-deep border border-border rounded-2xl shadow-2xl overflow-hidden focus:outline-none">

            <div className="flex items-center px-6 pt-5 pb-5 border-b border-border">
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                Workspace needs attention
              </Dialog.Title>
            </div>

            <div className="px-6 pt-6 pb-6 flex flex-col items-center gap-4 text-center">
              <AlertTriangle size={32} className="text-warning" />

              <div className="flex flex-col gap-1">
                <p className="text-[13px] font-semibold text-fg">
                  "{workspace.name}" is missing local files
                </p>
                <p className="text-[12px] text-fg-secondary mt-1 leading-relaxed">
                  The workspace folder was moved or deleted outside Braid.
                </p>
                <p className="text-[12px] text-fg-tertiary mt-0.5 leading-relaxed">
                  Your branch and any pushed commits are safe on remote.
                </p>
              </div>

              {error && (
                <div className="w-full rounded-lg px-3 py-2.5 bg-surface border border-error text-left">
                  <p className="text-[12px] text-error">{error}</p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between px-6 pb-6 pt-2">
              <button
                onClick={closeModal}
                disabled={loading}
                className="text-[13px] text-fg-tertiary hover:text-fg-secondary transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleRecreate}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-semibold bg-brand text-white hover:bg-brand-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Recreating…' : 'Recreate local files'}
              </button>
            </div>

          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
