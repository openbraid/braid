import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { track } from '../../lib/analytics'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Circle,
  Info,
  Loader2,
  X,
  XCircle
} from 'lucide-react'
import { Channels } from '../../../../shared/ipc-types'
import type { Repository } from '../../../../shared/ipc-types'
import { useUIStore } from '../../store/ui-store'
import { BraidMark } from '../ui/BraidMark'
import { promptSetupToast } from '../../lib/setup-toast'
import { useProjectStore } from '../../store/project-store'
import { useWorkspaceStore } from '../../store/workspace-store'
import { useScratchStore } from '../../store/scratch-store'
import { ipc } from '../../lib/ipc'

// ─── Types ────────────────────────────────────────────────────────────────────

type BranchValidation =
  | { type: 'none' }
  | { type: 'in_use'; workspaceName: string; workspaceId: string }
  | { type: 'use_existing' }

type ProgressStatus = 'pending' | 'active' | 'done' | 'error'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeBranch(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '') // only alphanumeric and hyphens — no slashes or dots
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StepIcon({ status }: { status: ProgressStatus }) {
  if (status === 'done')   return <CheckCircle2 size={13} className="text-success shrink-0" />
  if (status === 'active') return <Loader2      size={13} className="text-fg-secondary shrink-0 animate-spin" />
  if (status === 'error')  return <XCircle      size={13} className="text-error shrink-0" />
  return                          <Circle       size={13} className="text-fg-tertiary shrink-0" />
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CreateWorkspaceModal() {
  const { activeModal, modalContext, closeModal } = useUIStore()
  const { workspaces, setActiveWorkspace } = useWorkspaceStore()
  const { projects } = useProjectStore()

  const open = activeModal === 'create-workspace'
  const projectId = modalContext?.modal === 'create-workspace' ? modalContext.projectId : undefined
  const fromScratch = modalContext?.modal === 'create-workspace' && modalContext.fromScratch === true

  // Scratch context — only used when opened from the scratch bubble toolbar
  const scratchContext = useScratchStore((s) => s.scratchContextForModal)

  // Form state
  const [name, setName]                         = useState('')
  const [branchName, setBranchName]             = useState('')
  const [branchEdited, setBranchEdited]         = useState(false)
  const [sourceBranch, setSourceBranch]         = useState('')
  const [allBranches, setAllBranches]           = useState<string[]>([])
  const [perRepoBranches, setPerRepoBranches]   = useState<Map<string, string[]>>(new Map())
  const [perRepoSourceBranch, setPerRepoSourceBranch] = useState<Map<string, string>>(new Map())
  const [branchesLoading, setBranchesLoading]   = useState(false)
  const [branchFetchFailed, setBranchFetchFailed] = useState(false)
  const [validation, setValidation]             = useState<BranchValidation>({ type: 'none' })
  const [createError, setCreateError]           = useState<string | null>(null)
  const [selectedRepoIds, setSelectedRepoIds]   = useState<Set<string>>(new Set())

  // Name suggestion state
  const [nameSuggesting, setNameSuggesting]     = useState(false)

  // Loading / progress state
  const [creating, setCreating]                 = useState(false)
  const [progressStatus, setProgressStatus]     = useState<ProgressStatus>('pending')

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unsubRef    = useRef<(() => void) | null>(null)

  // Derive project repos from store
  const projectRepos: Repository[] = projectId
    ? (projects.find((p) => p.id === projectId)?.repos ?? [])
    : []
  const isMultiRepo = projectRepos.length > 1

  // Reset everything when modal opens
  useEffect(() => {
    if (!open) return
    setName('')
    setBranchName('')
    setBranchEdited(false)
    setSourceBranch('')
    setValidation({ type: 'none' })
    setCreateError(null)
    setCreating(false)
    setProgressStatus('pending')
    setNameSuggesting(false)
    setAllBranches([])
    setPerRepoBranches(new Map())
    setPerRepoSourceBranch(new Map())
    setBranchFetchFailed(false)
    // Select all repos by default
    setSelectedRepoIds(new Set(projectRepos.map((r) => r.id)))

    // Auto-fill from scratch context — only when opened from scratch toolbar
    if (fromScratch && scratchContext?.selectedText) {
      const text = scratchContext.selectedText.trim()
      const wordCount = text.split(/\s+/).length

      if (wordCount <= 5) {
        setName(text.split('\n')[0]?.trim().slice(0, 60) ?? '')
      } else {
        setNameSuggesting(true)
        ipc.workspaces.suggestName(text)
          .then((result) => {
            if (result.name) setName(result.name)
          })
          .catch(() => {})
          .finally(() => setNameSuggesting(false))
      }
    }

    if (!projectId) return

    setBranchesLoading(true)

    if (isMultiRepo) {
      // Multi-repo: fetch branches per repo
      ipc.git.branchesPerRepo(projectId)
        .then((results) => {
          setBranchFetchFailed(false)
          const branchMap = new Map<string, string[]>()
          const sourceMap = new Map<string, string>()
          const merged = new Set<string>()
          for (const r of results) {
            branchMap.set(r.repoId, r.branches)
            const preferred = r.branches.find((b) => b === 'main' || b === 'master') ?? r.branches[0] ?? ''
            sourceMap.set(r.repoId, preferred)
            for (const b of r.branches) merged.add(b)
          }
          setPerRepoBranches(branchMap)
          setPerRepoSourceBranch(sourceMap)
          setAllBranches(Array.from(merged))
          // Set global sourceBranch as fallback
          const firstPreferred = Array.from(sourceMap.values())[0] ?? 'main'
          setSourceBranch(firstPreferred)
        })
        .catch(() => {
          setBranchFetchFailed(true)
          setSourceBranch('main')
        })
        .finally(() => setBranchesLoading(false))
    } else {
      // Single-repo: fetch merged branches (existing behavior)
      ipc.git.branches(projectId)
        .then((branches) => {
          setAllBranches(branches)
          setBranchFetchFailed(false)
          const preferred = branches.find((b) => b === 'main' || b === 'master') ?? branches[0] ?? ''
          setSourceBranch(preferred)
        })
        .catch(() => {
          setAllBranches([])
          setBranchFetchFailed(true)
          setSourceBranch('main')
        })
        .finally(() => setBranchesLoading(false))
    }
  }, [open, projectId])

  // Cleanup progress subscription on unmount
  useEffect(() => () => { unsubRef.current?.() }, [])

  // Client-side workspace name uniqueness check
  const nameConflict = name.trim().length > 0 && projectId
    ? workspaces.find(
        (ws) =>
          ws.projectId === projectId &&
          ws.name.toLowerCase() === name.trim().toLowerCase()
      )
    : undefined

  // Auto-derive branch name from workspace name
  useEffect(() => {
    if (!branchEdited) setBranchName(sanitizeBranch(name))
  }, [name, branchEdited])

  // Debounced branch validation (300ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!branchName) { setValidation({ type: 'none' }); return }
    debounceRef.current = setTimeout(() => validateBranch(branchName), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [branchName, workspaces]) // eslint-disable-line react-hooks/exhaustive-deps

  function validateBranch(branch: string) {
    const conflict = workspaces.find((ws) => ws.projectId === projectId && ws.branchName === branch)
    if (conflict) {
      setValidation({ type: 'in_use', workspaceName: conflict.name, workspaceId: conflict.id })
      return
    }
    // If this branch exists in git but isn't tied to a workspace — use as-is
    const existingUnattached =
      allBranches.includes(branch) &&
      !workspaces.some((ws) => ws.projectId === projectId && ws.branchName === branch)
    if (existingUnattached) {
      setValidation({ type: 'use_existing' })
      return
    }
    setValidation({ type: 'none' })
  }

  function handleOpenConflict() {
    if (validation.type !== 'in_use') return
    setActiveWorkspace(validation.workspaceId)
    ipc.workspaces.open(validation.workspaceId)
    closeModal()
  }

  async function handleCreate() {
    if (!projectId || !name.trim() || !branchName.trim() || validation.type === 'in_use' || nameConflict) return
    setCreateError(null)
    setCreating(true)
    setProgressStatus('active')

    // Subscribe before the call; always unsubscribe in finally — no leaks on any path
    unsubRef.current?.()
    unsubRef.current = ipc.on(Channels.WORKSPACE_CREATE_PROGRESS, (step) => {
      if (step.status === 'done')  setProgressStatus('done')
      if (step.status === 'error') setProgressStatus('error')
    })

    try {
      const workspace = await ipc.workspaces.create({
        projectId,
        name: name.trim(),
        branchName,
        sourceBranch,
        repos: isMultiRepo
          ? Array.from(selectedRepoIds).map((repoId) => ({
              repoId,
              sourceBranch: perRepoSourceBranch.get(repoId) || sourceBranch
            }))
          : undefined
      })
      setProgressStatus('done')
      track('workspace_created', { repo_count: selectedRepoIds.size })

      // Check for setup script — if found, show a non-blocking toast
      const setupCheck = await ipc.workspaces.checkSetup(workspace.id)
      if (setupCheck.hasSetupScript) {
        promptSetupToast(workspace.id, setupCheck.repoNames)
      }

      // Launch agent — only when opened from scratch toolbar
      if (fromScratch && scratchContext?.defaultAgent && scratchContext.selectedText) {
        ipc.scratch.launchAgent(scratchContext.defaultAgent, scratchContext.selectedText, workspace.id)
      }

      setTimeout(() => closeModal(), 600)
    } catch (err: unknown) {
      setProgressStatus('error')
      const code = (err instanceof Error && 'code' in err) ? (err as { code: string }).code : undefined
      if (code === 'WORKSPACE_NAME_TAKEN') {
        setCreateError('A workspace with this name already exists in this project.')
      } else if (code === 'BRANCH_NAME_TAKEN') {
        setCreateError('This branch is already used by another workspace.')
      } else {
        setCreateError((err as { message?: string })?.message ?? 'Failed to create workspace.')
      }
      setCreating(false)
    } finally {
      unsubRef.current?.()
      unsubRef.current = null
    }
  }

  // Check if sanitized workspace name would collide with a repo name
  const nameRepoConflict = name.trim()
    ? projectRepos.find((r) => r.name.toLowerCase() === sanitizeBranch(name).toLowerCase())
    : undefined

  const canCreate = !!name.trim() && !!branchName.trim() && validation.type !== 'in_use' && !nameConflict && !nameRepoConflict && selectedRepoIds.size > 0

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => {
      if (!isOpen && !creating) {
        useScratchStore.getState().setScratchContextForModal(null)
        closeModal()
      }
    }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 flex items-center justify-center p-6">
          <Dialog.Content
            className="w-full max-w-[520px] bg-surface-deep border border-border rounded-2xl shadow-2xl overflow-hidden focus:outline-none"
            onInteractOutside={(e) => { if (creating) e.preventDefault() }}
          >

            {/* ── Header ── */}
            <div className="flex items-center justify-between px-6 pt-5 pb-5 border-b border-border">
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                New Workspace
              </Dialog.Title>
              {!creating && (
                <button
                  onClick={closeModal}
                  className="text-fg-tertiary hover:text-fg-secondary transition-colors"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* ── Body ── */}
            <div className="px-6 pt-5 pb-6 flex flex-col gap-5">

              {/* Loading / progress view */}
              {creating && (
                <div className="flex flex-col items-center justify-center py-8 gap-5">
                  <BraidMark
                    size={28}
                    className={[
                      'transition-opacity',
                      progressStatus === 'done'  ? 'opacity-60' :
                      progressStatus === 'error' ? 'opacity-40'   :
                      'animate-pulse'
                    ].join(' ')}
                  />
                  <div className="flex items-center gap-2.5">
                    <StepIcon status={progressStatus} />
                    <span className={[
                      'text-[13px]',
                      progressStatus === 'error' ? 'text-error' :
                      progressStatus === 'done'  ? 'text-fg'    :
                      'text-fg-secondary'
                    ].join(' ')}>
                      {progressStatus === 'done'  ? 'Workspace ready' :
                       progressStatus === 'error' ? 'Something went wrong' :
                       'Creating workspace…'}
                    </span>
                  </div>

                  {createError && (
                    <div className="w-full rounded-lg px-4 py-3 flex gap-3 bg-surface border border-error">
                      <AlertCircle size={14} className="text-error shrink-0 mt-0.5" />
                      <div>
                        <p className="text-[12px] font-medium text-error">Creation failed</p>
                        <p className="text-[11px] text-fg-secondary mt-0.5 leading-relaxed">{createError}</p>
                      </div>
                    </div>
                  )}

                  {progressStatus === 'error' && (
                    <button
                      onClick={() => { setCreating(false); setCreateError(null); setProgressStatus('pending') }}
                      className="text-[13px] text-fg-secondary hover:text-fg transition-colors"
                    >
                      ← Go back and try again
                    </button>
                  )}
                </div>
              )}

              {/* Form view */}
              {!creating && (<>

                {/* Workspace name */}
                <div className="flex flex-col gap-2">
                  <p className="text-[13px] font-semibold text-fg">Workspace name</p>
                  <div className="relative">
                    <input
                      autoFocus
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && canCreate && !nameConflict && handleCreate()}
                      placeholder={nameSuggesting ? 'Suggesting name…' : 'e.g. auth-feature'}
                      disabled={nameSuggesting}
                      className={[
                        'w-full px-3 py-2.5 rounded-lg bg-surface border text-[13px] text-fg placeholder:text-fg-tertiary outline-none focus:border-border-strong transition-colors',
                        nameSuggesting ? 'pr-9' : '',
                        nameConflict ? 'border-error' : 'border-border'
                      ].join(' ')}
                    />
                    {nameSuggesting && (
                      <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-fg-tertiary" />
                    )}
                  </div>
                  {nameConflict && (
                    <p className="text-[11px] text-error">
                      A workspace named &ldquo;{nameConflict.name}&rdquo; already exists in this project.
                    </p>
                  )}
                </div>

                {/* Branch name */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between">
                    <p className="text-[13px] font-semibold text-fg">Branch name</p>
                    {!branchEdited && name.trim() && (
                      <span className="text-[11px] text-fg-tertiary font-mono">auto-derived</span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={branchName}
                    onChange={(e) => { setBranchEdited(true); setBranchName(e.target.value) }}
                    onKeyDown={(e) => e.key === 'Enter' && canCreate && handleCreate()}
                    placeholder="branch-name"
                    className={[
                      'w-full px-3 py-2.5 rounded-lg bg-surface border text-[13px] font-mono placeholder:text-fg-tertiary outline-none transition-colors',
                      validation.type === 'in_use'
                        ? 'border-error text-error focus:border-error'
                        : 'border-border text-fg focus:border-border-strong'
                    ].join(' ')}
                  />

                  {/* Validation feedback */}
                  {validation.type === 'in_use' && (
                    <div className="rounded-lg px-3 py-2.5 flex gap-2.5 bg-surface border border-error">
                      <AlertCircle size={13} className="text-error shrink-0 mt-0.5" />
                      <p className="text-[12px] text-error leading-snug">
                        Already used by{' '}
                        <button
                          type="button"
                          onClick={handleOpenConflict}
                          className="underline underline-offset-2 hover:text-error/70 transition-colors"
                        >
                          {validation.workspaceName}
                        </button>
                      </p>
                    </div>
                  )}
                  {validation.type === 'use_existing' && (
                    <div className="rounded-lg px-3 py-2.5 flex gap-2.5 bg-surface border border-border">
                      <Info size={13} className="text-fg-tertiary shrink-0 mt-0.5" />
                      <p className="text-[12px] text-fg-secondary leading-snug">
                        Existing branch — will be used as-is. No new branch will be created.
                      </p>
                    </div>
                  )}
                  {nameRepoConflict && (
                    <div className="rounded-lg px-3 py-2.5 flex gap-2.5 bg-surface border border-error">
                      <AlertCircle size={13} className="text-error shrink-0 mt-0.5" />
                      <p className="text-[12px] text-error leading-snug">
                        Workspace name conflicts with repository &ldquo;{nameRepoConflict.name}&rdquo;.
                      </p>
                    </div>
                  )}
                </div>

                {/* Repositories + per-repo source branch (multi-repo only) */}
                {isMultiRepo && (
                  <div className="flex flex-col gap-2">
                    <div>
                      <p className="text-[13px] font-semibold text-fg">Repositories</p>
                      <p className="text-[12px] text-fg-tertiary mt-0.5">Choose repos and their source branch.</p>
                    </div>
                    <div className="flex flex-col border border-border rounded-lg overflow-hidden max-h-52 overflow-y-auto">
                      {projectRepos.map((repo, i) => {
                        const checked = selectedRepoIds.has(repo.id)
                        const repoBranches = perRepoBranches.get(repo.id) ?? allBranches
                        const repoSource = perRepoSourceBranch.get(repo.id) ?? sourceBranch
                        return (
                          <div
                            key={repo.id}
                            className={['px-3 py-2.5 transition-colors', i > 0 ? 'border-t border-border' : ''].join(' ')}
                          >
                            <label className="flex items-center gap-3 cursor-pointer">
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
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  setSelectedRepoIds((prev) => {
                                    const next = new Set(prev)
                                    next.has(repo.id) ? next.delete(repo.id) : next.add(repo.id)
                                    return next
                                  })
                                }}
                                className="sr-only"
                              />
                              <span className="text-[13px] text-fg font-medium">{repo.name}</span>
                            </label>
                            {checked && (
                              <div className="flex items-center gap-2 mt-1.5 ml-7">
                                <span className="text-[11px] text-fg-tertiary shrink-0">from</span>
                                <div className="relative flex-1">
                                  <select
                                    value={repoSource}
                                    onChange={(e) => {
                                      setPerRepoSourceBranch((prev) => {
                                        const next = new Map(prev)
                                        next.set(repo.id, e.target.value)
                                        return next
                                      })
                                    }}
                                    className="w-full appearance-none pl-2 pr-6 py-1 rounded bg-surface border border-border text-[11px] text-fg-secondary font-mono outline-none focus:border-border-strong transition-colors cursor-pointer"
                                  >
                                    {repoBranches.map((b) => (
                                      <option key={b} value={b}>{b}</option>
                                    ))}
                                  </select>
                                  <ChevronDown
                                    size={10}
                                    className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-fg-tertiary"
                                  />
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Source branch (single-repo only — multi-repo has per-repo pickers above) */}
                {!isMultiRepo && (
                <div className="flex flex-col gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-fg">Source branch</p>
                    <p className="text-[12px] text-fg-tertiary mt-0.5">
                      New workspace branches off from here.
                    </p>
                  </div>

                  {branchesLoading ? (
                    <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-surface border border-border text-[13px] text-fg-tertiary">
                      <Loader2 size={13} className="animate-spin shrink-0" />
                      Loading branches…
                    </div>
                  ) : branchFetchFailed ? (
                    <input
                      type="text"
                      value={sourceBranch}
                      onChange={(e) => setSourceBranch(e.target.value)}
                      placeholder="e.g. main"
                      className="w-full px-3 py-2.5 rounded-lg bg-surface border border-border text-[13px] text-fg font-mono placeholder:text-fg-tertiary outline-none focus:border-border-strong transition-colors"
                    />
                  ) : (
                    <div className="relative">
                      <select
                        value={sourceBranch}
                        onChange={(e) => setSourceBranch(e.target.value)}
                        className="w-full appearance-none px-3 py-2.5 pr-9 rounded-lg bg-surface border border-border text-[13px] text-fg font-mono outline-none focus:border-border-strong transition-colors cursor-pointer"
                      >
                        {allBranches.length === 0 && (
                          <option value="">No branches found</option>
                        )}
                        {allBranches.map((b) => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                      <ChevronDown
                        size={13}
                        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-tertiary"
                      />
                    </div>
                  )}
                </div>
                )}

              </>)}
            </div>

            {/* ── Footer ── */}
            {!creating && (
              <div className="flex items-center justify-between px-6 pb-6 pt-1">
                <button
                  onClick={closeModal}
                  className="text-[13px] text-fg-tertiary hover:text-fg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreate}
                  disabled={!canCreate}
                  className={[
                    'flex items-center gap-2 px-5 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors',
                    canCreate
                      ? 'bg-brand hover:bg-brand-hover cursor-pointer'
                      : 'bg-brand opacity-30 cursor-not-allowed'
                  ].join(' ')}
                >
                  Create Workspace
                </button>
              </div>
            )}

          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
