import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { useUIStore } from '../../store/ui-store'
import { useWorkspaceStore } from '../../store/workspace-store'
import { track } from '../../lib/analytics'
import { useTerminalStore } from '../../store/terminal-store'
import { ipc } from '../../lib/ipc'

export function CloseWorkspaceModal() {
  const { activeModal, modalContext, closeModal } = useUIStore()
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const terminals = useTerminalStore((s) => s.terminals)

  const workspaceId = modalContext?.modal === 'close-workspace' ? modalContext.workspaceId : undefined
  const workspace = workspaces.find((ws) => ws.id === workspaceId)

  const [removeFiles, setRemoveFiles] = useState(false)
  const [gitChangeCount, setGitChangeCount] = useState(0)
  const [loading, setLoading] = useState(false)

  const open = activeModal === 'close-workspace'

  useEffect(() => {
    if (!workspaceId || !open) return
    setRemoveFiles(false)
    setGitChangeCount(0)
    ipc.git.status(workspaceId).then((result) => {
      setGitChangeCount(result.changedFiles)
    }).catch(() => {})
  }, [workspaceId, open])

  if (!workspace) return null

  const workspaceTerminals = terminals.get(workspace.id) ?? []
  const hasActiveSession = workspaceTerminals.some(
    (t) => t.status === 'running' || t.status === 'waiting'
  )
  const hasUncommittedChanges = removeFiles && gitChangeCount > 0

  async function handleConfirm() {
    if (!workspaceId) return
    setLoading(true)
    try {
      await ipc.workspaces.close(workspaceId, removeFiles)
      track('workspace_closed', { remove_files: removeFiles })
    } finally {
      setLoading(false)
      closeModal()
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen && !loading) closeModal() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <Dialog.Content className="w-full max-w-[440px] bg-surface-deep border border-border rounded-2xl shadow-2xl overflow-hidden focus:outline-none">

            <div className="flex items-center px-6 pt-5 pb-5 border-b border-border">
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                Close "{workspace.name}"
              </Dialog.Title>
            </div>

            <div className="px-6 pt-5 pb-6 flex flex-col gap-4">
              {hasActiveSession && (
                <div className="flex items-start gap-2.5 px-3 py-3 bg-surface border border-border rounded-lg">
                  <AlertTriangle size={13} className="text-warning shrink-0 mt-0.5" />
                  <span className="text-[12px] text-fg-secondary leading-snug">
                    An agent session is active in this workspace.
                  </span>
                </div>
              )}

              <div className="flex flex-col gap-2">
                <label className="flex items-start gap-3 px-3 py-3 rounded-lg border border-border cursor-pointer hover:bg-surface-hover transition-colors">
                  <input
                    type="radio"
                    name="close-mode"
                    checked={!removeFiles}
                    onChange={() => setRemoveFiles(false)}
                    className="mt-0.5 accent-brand shrink-0"
                  />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[13px] font-semibold text-fg">Keep local files</span>
                    <span className="text-[12px] text-fg-secondary leading-snug">
                      Your code changes stay on disk. Reopen anytime, pick up exactly where you left off.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 px-3 py-3 rounded-lg border border-border cursor-pointer hover:bg-surface-hover transition-colors">
                  <input
                    type="radio"
                    name="close-mode"
                    checked={removeFiles}
                    onChange={() => setRemoveFiles(true)}
                    className="mt-0.5 accent-brand shrink-0"
                  />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[13px] font-semibold text-fg">Remove local files</span>
                    <span className="text-[12px] text-fg-secondary leading-snug">
                      Frees up disk space. Your branch and commits are safe — as long as they're pushed to remote.
                    </span>
                    {hasUncommittedChanges && (
                      <div className="flex items-start gap-1.5 mt-2">
                        <AlertTriangle size={12} className="text-warning shrink-0 mt-0.5" />
                        <span className="text-[12px] text-warning leading-snug">
                          This workspace has uncommitted changes. They will be lost.
                        </span>
                      </div>
                    )}
                  </div>
                </label>
              </div>
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
                onClick={handleConfirm}
                disabled={loading}
                className="px-5 py-2 rounded-lg text-[13px] font-semibold bg-surface-hover border border-border text-fg hover:bg-surface-active transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {loading ? 'Closing…' : 'Close Workspace'}
              </button>
            </div>

          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
