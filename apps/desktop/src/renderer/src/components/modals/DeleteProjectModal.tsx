import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle } from 'lucide-react'
import { useUIStore } from '../../store/ui-store'
import { useProjectStore } from '../../store/project-store'
import { track } from '../../lib/analytics'
import { ipc } from '../../lib/ipc'
import { handleProjectScopedError } from '../../lib/invalidate-project'

export function DeleteProjectModal() {
  const { activeModal, modalContext, closeModal } = useUIStore()
  const open = activeModal === 'delete-project'
  const projectId = modalContext?.modal === 'delete-project' ? modalContext.projectId : undefined
  const project = useProjectStore((s) => projectId ? s.projects.find((p) => p.id === projectId) : undefined)

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setInput('')
    setError(null)
    setLoading(false)
    // Focus the confirmation input so the user can immediately start typing.
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  if (!project) return null

  const canConfirm = input.trim() === project.name && !loading

  async function handleDelete() {
    if (!canConfirm || !projectId || !project) return
    setError(null)
    setLoading(true)
    try {
      await ipc.projects.delete(projectId)
      track('project_deleted')
      // PROJECT_DELETED push event triggers the full cleanup cascade — we just
      // close the modal here. Navigation home happens via invalidateProject.
      closeModal()
    } catch (err) {
      // Stale-client case: someone else already deleted it, or we lost owner
      // access since we last checked. Invalidate + close silently.
      if (handleProjectScopedError(err, projectId, project.name)) {
        closeModal()
        return
      }
      setLoading(false)
      setError((err as { message?: string })?.message ?? 'Failed to delete project')
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen && !loading) closeModal() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
          <Dialog.Content className="w-full max-w-[460px] bg-surface-deep border border-border rounded-2xl shadow-2xl overflow-hidden focus:outline-none">

            {/* ── Header ── */}
            <div className="flex items-center px-6 pt-5 pb-5 border-b border-border">
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                Delete "{project.name}"?
              </Dialog.Title>
            </div>

            {/* ── Body ── */}
            <div className="px-6 pt-5 pb-6 flex flex-col gap-4">

              <div className="flex items-start gap-2.5 px-3 py-3 rounded-lg bg-error/5 border border-error/30 select-text cursor-text">
                <AlertTriangle size={13} className="text-error shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 flex flex-col gap-1 text-[12px] leading-snug select-text">
                  <p className="text-error font-medium select-text">This cannot be undone.</p>
                  <p className="text-fg-secondary select-text">
                    All workspaces, artifacts, and session history for this project will be permanently deleted for you and every contributor.
                  </p>
                  {project.localPath && (
                    <p className="text-fg-tertiary break-all select-text">
                      Cloned files at <span className="font-mono select-text">{project.localPath}</span> will remain on disk.
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[12px] text-fg-secondary leading-relaxed">
                  To confirm, type <span className="font-semibold text-fg">{project.name}</span> below:
                </label>
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && canConfirm) handleDelete() }}
                  disabled={loading}
                  placeholder={project.name}
                  className="h-9 px-3 text-[13px] text-fg bg-surface border border-border rounded-md outline-none focus:border-error placeholder:text-fg-tertiary transition-colors disabled:opacity-50"
                />
              </div>

              {error && (
                <div className="rounded-lg px-3 py-2.5 bg-surface border border-error select-text cursor-text">
                  <p className="text-[12px] text-error leading-relaxed select-text">{error}</p>
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            <div className="flex items-center justify-between px-6 pb-6 pt-2">
              <button
                onClick={closeModal}
                disabled={loading}
                className="text-[13px] text-fg-tertiary hover:text-fg-secondary transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!canConfirm}
                className={[
                  'px-5 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors',
                  canConfirm
                    ? 'bg-error hover:bg-error/90 cursor-pointer'
                    : 'bg-error opacity-30 cursor-not-allowed'
                ].join(' ')}
              >
                {loading ? 'Deleting…' : 'Delete project'}
              </button>
            </div>

          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
