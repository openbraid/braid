import { useState, useCallback, useEffect, useRef } from 'react'
import { AlertCircle, CheckCircle2, Circle, Loader2, X, XCircle } from 'lucide-react'
import { BraidMark } from '../ui/BraidMark'
import { track } from '../../lib/analytics'

function StepIcon({ status }: { status: 'pending' | 'active' | 'done' | 'error' }) {
  if (status === 'done')   return <CheckCircle2 size={13} className="text-success shrink-0" />
  if (status === 'active') return <Loader2      size={13} className="text-fg-secondary shrink-0 animate-spin" />
  if (status === 'error')  return <XCircle      size={13} className="text-error shrink-0" />
  return                          <Circle       size={13} className="text-fg-tertiary shrink-0" />
}
import { ipc } from '../../lib/ipc'
import { useProjectStore } from '../../store/project-store'
import { useWorkspaceStore } from '../../store/workspace-store'
import type { ScannedRepo, ProjectCreateProgressStep } from '../../../../shared/ipc-types'
import { Channels } from '../../../../shared/ipc-types'
import type { LoadingStep } from './LoadingScreen'

type Props = {
  onClose: () => void
}

export function AddProjectFlow({ onClose }: Props) {
  const addProject = useProjectStore((s) => s.addProject)
  const { setActiveProjectId, setActiveView } = useWorkspaceStore()

  const [folderPath, setFolderPath]       = useState<string | null>(null)
  const [isDragOver, setIsDragOver]       = useState(false)
  const [scanError, setScanError]         = useState<string | null>(null)
  const [scannedRepos, setScannedRepos]   = useState<ScannedRepo[]>([])
  const [selectedRepos, setSelectedRepos] = useState<Set<string>>(new Set())
  const [projectName, setProjectName]     = useState('')
  const [creating, setCreating]           = useState(false)
  const [createError, setCreateError]     = useState<string | null>(null)
  const [loadingSteps, setLoadingSteps]   = useState<LoadingStep[]>([])

  const projects = useProjectStore((s) => s.projects)
  const hasScanned = scannedRepos.length > 0
  const nameConflict = projectName.trim().length > 0
    ? projects.find((p) => p.name.toLowerCase() === projectName.trim().toLowerCase())
    : undefined
  const canCreate  = hasScanned && projectName.trim().length > 0 && selectedRepos.size > 0 && !nameConflict

  const unsubRef = useRef<(() => void) | null>(null)
  useEffect(() => { return () => { unsubRef.current?.() } }, [])

  async function scanFolder(path: string) {
    setScanError(null)
    const repos = await ipc.projects.scanFolder(path)
    if (repos.length === 0) {
      setFolderPath(path)
      setScannedRepos([])
      setSelectedRepos(new Set())
      setScanError('no-repos')
      return
    }
    setFolderPath(path)
    setScannedRepos(repos)
    setSelectedRepos(new Set(repos.map((r) => r.path)))
    setProjectName(path.split('/').at(-1) ?? '')
  }

  async function handleBrowse() {
    const path = await ipc.dialog.openFolder()
    if (!path) return
    await scanFolder(path)
  }

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0] as File & { path?: string }
    const path = file?.path
    if (!path) return
    await scanFolder(path)
  }, [])

  function toggleRepo(path: string) {
    setSelectedRepos((prev) => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }

  async function handleCreate() {
    if (!folderPath || !canCreate) return
    setCreateError(null)

    setLoadingSteps([
      { label: 'Creating project', status: 'pending' }
    ])
    setCreating(true)

    // Listen for progress events pushed from main
    unsubRef.current?.()
    unsubRef.current = ipc.on(Channels.PROJECT_CREATE_PROGRESS, (step: ProjectCreateProgressStep) => {
      setLoadingSteps((prev) => {
        const idx = prev.findIndex((s) => s.label === step.label)
        if (idx === -1) return prev
        const next = [...prev]
        const mapped: LoadingStep['status'] =
          step.status === 'done' ? 'done' : step.status === 'error' ? 'error' : 'active'
        next[idx] = { label: step.label, status: mapped }
        // Mark prior pending steps as done when a later step becomes active
        for (let i = 0; i < idx; i++) {
          if (next[i].status === 'pending') next[i] = { ...next[i], status: 'done' }
        }
        return next
      })
    })

    try {
      const repos = scannedRepos.filter((r) => selectedRepos.has(r.path))
      const project = await ipc.projects.create({
        name: projectName.trim(),
        localPath: folderPath,
        repos: repos.map((r) => ({ name: r.name, remoteUrl: r.remoteUrl }))
      })

      unsubRef.current?.()
      unsubRef.current = null

      track('project_created', { repo_count: repos.length })
      addProject(project)
      setActiveProjectId(project.id)
      setActiveView('project')
      onClose()
    } catch (err) {
      unsubRef.current?.()
      unsubRef.current = null
      setCreating(false)
      const code = (err instanceof Error && 'code' in err) ? (err as { code: string }).code : undefined
      if (code === 'PROJECT_NAME_TAKEN') {
        setCreateError('A project with this name already exists.')
      } else {
        setCreateError((err as { message?: string })?.message ?? 'Failed to create project.')
      }
    }
  }

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="w-full max-w-[580px] bg-surface-deep border border-border rounded-2xl shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-5 border-b border-border">
          <h2 className="text-[15px] font-semibold text-fg">Add Project</h2>
          <button onClick={onClose} className="text-fg-tertiary hover:text-fg-secondary transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 pt-5 pb-6 flex flex-col gap-5">

          {/* Progress (while creating) */}
          {creating && (
            <div className="flex flex-col items-center justify-center py-8 gap-5">
              <BraidMark size={28} className="animate-pulse" />
              <div className="flex flex-col gap-2.5">
                {loadingSteps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2.5">
                    <StepIcon status={step.status} />
                    <span className={[
                      'text-[13px]',
                      step.status === 'pending' ? 'text-fg-tertiary' : 'text-fg',
                      step.status === 'error' ? 'text-error' : ''
                    ].join(' ')}>
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!creating && (<>

          {/* Drop zone */}
          {!hasScanned && !scanError && (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={[
                'flex flex-col items-center justify-center gap-4 py-10 rounded-xl transition-colors cursor-default border border-dashed',
                isDragOver ? 'bg-brand-subtle border-brand' : 'bg-surface border-border-strong'
              ].join(' ')}
            >
              <BraidMark size={36} className={isDragOver ? 'opacity-100' : 'opacity-40'} />
              <div className="text-center">
                <p className="text-[13px] text-fg-secondary">Drop your project folder here</p>
                <p className="text-[12px] text-fg-tertiary mt-1">
                  or{' '}
                  <button onClick={handleBrowse} className="text-fg-secondary hover:text-fg underline underline-offset-2 transition-colors">
                    browse
                  </button>
                  {' '}to select a folder
                </p>
              </div>
            </div>
          )}

          {/* Folder path row */}
          {folderPath && hasScanned && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-surface border border-border">
              <BraidMark size={14} className="shrink-0" />
              <span className="text-[12px] text-fg-secondary font-mono truncate flex-1">{folderPath}</span>
              <button onClick={handleBrowse} className="text-[11px] text-fg-tertiary hover:text-fg-secondary transition-colors shrink-0">
                change
              </button>
            </div>
          )}

          {/* No repos error */}
          {scanError === 'no-repos' && (
            <div className="flex flex-col gap-3">
              <div className="rounded-lg px-4 py-3 flex gap-3 bg-surface border border-error">
                <AlertCircle size={14} className="text-error shrink-0 mt-0.5" />
                <div>
                  <p className="text-[12px] font-medium text-error">No git repositories found</p>
                  <p className="text-[11px] text-fg-secondary mt-0.5 leading-relaxed">
                    Select a folder containing git repos as subfolders, or a single git repo directly.
                  </p>
                </div>
              </div>
              <button onClick={handleBrowse} className="text-[12px] text-fg-secondary hover:text-fg transition-colors text-left">
                ← Try a different folder
              </button>
            </div>
          )}

          {/* Repositories */}
          {hasScanned && (
            <div className="flex flex-col gap-2">
              <div>
                <p className="text-[13px] font-semibold text-fg">Repositories</p>
                <p className="text-[12px] text-fg-tertiary mt-0.5">Choose which repos to include.</p>
              </div>
              <div className="flex flex-col border border-border rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {scannedRepos.map((repo, i) => {
                  const checked = selectedRepos.has(repo.path)
                  return (
                    <label
                      key={repo.path}
                      className={['flex items-center gap-3 px-3 py-3 cursor-pointer transition-colors hover:bg-surface-hover', i > 0 ? 'border-t border-border' : ''].join(' ')}
                    >
                      <div
                        className={['w-4 h-4 rounded shrink-0 flex items-center justify-center transition-colors', checked ? 'bg-brand' : 'bg-transparent border-border-strong'].join(' ')}
                        style={{ border: checked ? 'none' : '1.5px solid' }}
                      >
                        {checked && (
                          <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                            <path d="M1 3.5L3.5 6L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <input type="checkbox" checked={checked} onChange={() => toggleRepo(repo.path)} className="sr-only" />
                      <span className="text-[14px] text-fg font-medium">{repo.name}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          {/* Project name + default workspace name */}
          {hasScanned && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <p className="text-[13px] font-semibold text-fg">Project name</p>
                <input
                  autoFocus
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && canCreate && handleCreate()}
                  placeholder="My Project"
                  className={[
                    'w-full px-3 py-2.5 rounded-lg bg-surface border text-[13px] text-fg placeholder:text-fg-tertiary outline-none transition-colors',
                    nameConflict ? 'border-error' : 'border-border focus:border-border-strong'
                  ].join(' ')}
                />
                {nameConflict && (
                  <p className="text-[11px] text-error mt-1">
                    A project named &ldquo;{nameConflict.name}&rdquo; already exists.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Create error */}
          {createError && (
            <div className="rounded-lg px-4 py-3 flex gap-3 bg-surface border border-error select-text cursor-text">
              <AlertCircle size={14} className="text-error shrink-0 mt-0.5" />
              <p className="text-[12px] text-error select-text">{createError}</p>
            </div>
          )}

          </>)}

        </div>

        {/* Footer */}
        {!creating && (
          <div className="flex items-center justify-between px-6 py-4">
            <button onClick={onClose} className="text-[13px] text-fg-tertiary hover:text-fg-secondary transition-colors">
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={!canCreate}
              className={[
                'flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors',
                canCreate ? 'bg-brand hover:bg-brand-hover cursor-pointer' : 'bg-brand opacity-30 cursor-not-allowed'
              ].join(' ')}
            >
              Create Project
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
