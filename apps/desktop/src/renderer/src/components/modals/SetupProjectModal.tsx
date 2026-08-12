import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, CheckCircle2, Circle, FolderOpen, Loader2, X, XCircle } from 'lucide-react'
import { Channels } from '../../../../shared/ipc-types'
import { BraidMark } from '../ui/BraidMark'
import { ipc } from '../../lib/ipc'
import { useProjectStore } from '../../store/project-store'
import { useUIStore } from '../../store/ui-store'

type ProgressStatus = 'pending' | 'active' | 'done' | 'error'

function StepIcon({ status }: { status: ProgressStatus }) {
  if (status === 'done')   return <CheckCircle2 size={13} className="text-success shrink-0" />
  if (status === 'active') return <Loader2      size={13} className="text-fg-secondary shrink-0 animate-spin" />
  if (status === 'error')  return <XCircle      size={13} className="text-error shrink-0" />
  return                          <Circle       size={13} className="text-fg-tertiary shrink-0" />
}

export function SetupProjectModal() {
  const { activeModal, modalContext, closeModal } = useUIStore()
  const open = activeModal === 'setup-project'
  const projectId = modalContext?.modal === 'setup-project' ? modalContext.projectId : undefined

  const project = useProjectStore((s) => projectId ? s.projects.find((p) => p.id === projectId) : undefined)
  const status = useProjectStore((s) => projectId ? s.setupStatuses.get(projectId) : undefined)

  const [folder, setFolder]   = useState<string | null>(null)
  const [cloning, setCloning] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  const [steps, setSteps]     = useState<Array<{ label: string; status: ProgressStatus }>>([])

  const unsubRef = useRef<(() => void) | null>(null)

  // Reset on open; prefill parent folder when recovering a "missing" setup.
  useEffect(() => {
    if (!open) return
    setFolder(status?.status === 'missing' ? status.localPath : null)
    setCloning(false)
    setError(null)
    setSteps([])
  }, [open, status])

  // Auto-close when the project flips to 'setup' (e.g. cloning completed and
  // PROJECT_UPDATED refreshed the store).
  useEffect(() => {
    if (open && status?.status === 'setup' && !cloning) closeModal()
  }, [open, status?.status, cloning, closeModal])

  useEffect(() => () => { unsubRef.current?.() }, [])

  if (!project || !status) return null

  async function handleBrowse() {
    const path = await ipc.dialog.openFolder()
    if (path) setFolder(path)
  }

  async function handleClone() {
    if (!projectId || !folder || cloning) return
    setError(null)
    setCloning(true)
    setSteps(project!.repos.map((r) => ({ label: `Cloning ${r.name}`, status: 'pending' as ProgressStatus })))

    unsubRef.current?.()
    unsubRef.current = ipc.on(Channels.PROJECT_SETUP_PROGRESS, (step) => {
      setSteps((prev) => {
        const idx = prev.findIndex((s) => s.label === step.label)
        if (idx === -1) return prev
        const next = [...prev]
        const mapped: ProgressStatus =
          step.status === 'done' ? 'done' : step.status === 'error' ? 'error' : 'active'
        next[idx] = { label: step.label, status: mapped }
        for (let i = 0; i < idx; i++) {
          if (next[i].status === 'pending') next[i] = { ...next[i], status: 'done' }
        }
        return next
      })
    })

    try {
      await ipc.projects.setupLocally(projectId, folder)
      unsubRef.current?.()
      unsubRef.current = null
      // App.tsx's PROJECT_UPDATED listener refreshes setup status; the auto-close
      // effect above will close the modal when status flips to 'setup'.
      setCloning(false)
    } catch (err) {
      unsubRef.current?.()
      unsubRef.current = null
      setCloning(false)
      setError((err as { message?: string })?.message ?? 'Failed to set up project')
    }
  }

  const headerCopy = status.status === 'not-setup'
    ? `Set up "${project.name}" locally`
    : `Restore "${project.name}" locally`

  const introCopy = status.status === 'not-setup'
    ? `Pick a parent folder — we'll clone ${project.repos.length === 1 ? 'the repo' : `all ${project.repos.length} repos`} there.`
    : status.status === 'missing' && status.localPathExists
      ? `Missing: ${status.missingRepoNames.join(', ')}. Re-clone into the same parent folder to continue.`
      : `The project folder is gone. Pick a parent folder to re-clone into.`

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => { if (!isOpen && !cloning) closeModal() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 flex items-center justify-center p-6">
          <Dialog.Content
            className="w-full max-w-[520px] bg-surface-deep border border-border rounded-2xl shadow-2xl overflow-hidden focus:outline-none"
            onInteractOutside={(e) => { if (cloning) e.preventDefault() }}
          >
            {/* ── Header ── */}
            <div className="flex items-center justify-between px-6 pt-5 pb-5 border-b border-border">
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                {headerCopy}
              </Dialog.Title>
              {!cloning && (
                <button
                  onClick={closeModal}
                  className="text-fg-tertiary hover:text-fg-secondary transition-colors"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* ── Body ── */}
            <div className="px-6 pt-5 pb-6 flex flex-col gap-4">

              {!cloning && (
                <p className="text-[13px] text-fg-secondary leading-relaxed">{introCopy}</p>
              )}

              {!cloning && (
                <div className="flex flex-col gap-2">
                  <p className="text-[13px] font-semibold text-fg">Parent folder</p>
                  <button
                    onClick={handleBrowse}
                    className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-surface border border-border hover:border-border-strong text-left transition-colors"
                  >
                    <FolderOpen size={14} className="text-fg-tertiary shrink-0" />
                    <span className={['text-[12px] font-mono truncate flex-1', folder ? 'text-fg' : 'text-fg-tertiary'].join(' ')}>
                      {folder ?? 'Choose a folder…'}
                    </span>
                    <span className="text-[11px] text-fg-tertiary shrink-0">
                      {folder ? 'change' : 'browse'}
                    </span>
                  </button>

                  {folder && (
                    <div className="flex flex-col gap-1.5 mt-1 px-3.5 py-2.5 rounded-lg bg-surface border border-border">
                      <p className="text-[11px] text-fg-tertiary">Will clone here:</p>
                      {project.repos.map((r) => (
                        <p key={r.id} className="text-[12px] font-mono text-fg-secondary break-all leading-snug">
                          {folder}/{r.name}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {cloning && (
                <div className="flex flex-col items-center justify-center py-6 gap-5">
                  <BraidMark size={28} className="animate-pulse" />
                  <div className="flex flex-col gap-2.5 w-full">
                    {steps.map((step, i) => (
                      <div key={i} className="flex items-center gap-2.5">
                        <StepIcon status={step.status} />
                        <span className={['text-[13px]', step.status === 'pending' ? 'text-fg-tertiary' : 'text-fg', step.status === 'error' ? 'text-error' : ''].join(' ')}>
                          {step.label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {error && (
                <div className="rounded-lg px-4 py-3 flex gap-3 bg-surface border border-error select-text cursor-text">
                  <AlertCircle size={14} className="text-error shrink-0 mt-0.5" />
                  <p className="text-[12px] text-error select-text leading-relaxed">{error}</p>
                </div>
              )}
            </div>

            {/* ── Footer ── */}
            {!cloning && (
              <div className="flex items-center justify-between px-6 pb-6 pt-1">
                <button
                  onClick={closeModal}
                  className="text-[13px] text-fg-tertiary hover:text-fg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleClone}
                  disabled={!folder}
                  className={[
                    'flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors',
                    folder
                      ? 'bg-brand hover:bg-brand-hover cursor-pointer'
                      : 'bg-brand opacity-30 cursor-not-allowed'
                  ].join(' ')}
                >
                  {status.status === 'missing' ? 'Restore' : 'Set up'}
                </button>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
