import { AlertTriangle, Check, Copy, GitBranch, MoreHorizontal, Pin, X } from 'lucide-react'
import type { WorkspaceWithLocal, WorkspaceTerminalEntry } from '../../../../shared/ipc-types'
import { useTerminalStore } from '../../store/terminal-store'
import { useUIStore } from '../../store/ui-store'
import { track } from '../../lib/analytics'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '../ui/DropdownMenu'
import { ipc } from '../../lib/ipc'
import { toast } from 'sonner'

const EMPTY_TERMINALS: WorkspaceTerminalEntry[] = []

type Props = {
  workspace: WorkspaceWithLocal
  isActive: boolean
  isBroken: boolean
  onActivate: () => void
  onTogglePin: (workspaceId: string, isPinned: boolean) => void
}

export function WorkspaceCard({ workspace, isActive, isBroken, onActivate, onTogglePin }: Props) {
  const terminals = useTerminalStore((s) => s.terminals.get(workspace.id) ?? EMPTY_TERMINALS)
  const { openModal } = useUIStore()

  const activeTerminals = terminals.filter((t) => t.command !== null && t.status !== 'completed')
  const completedTerminals = terminals.filter((t) => t.command !== null && t.status === 'completed')
  const hasProcesses = activeTerminals.length > 0 || completedTerminals.length > 0

  function handleCardClick() {
    if (isBroken) {
      openModal('broken-workspace', { modal: 'broken-workspace', workspaceId: workspace.id })
      return
    }
    // Switch UI immediately — useEffect in App.tsx handles lazy initialization
    track('workspace_opened')
    onActivate()
    // Ensure workspace is ready in background
    ipc.workspaces.open(workspace.id).catch(() => {
      // Only toast if the workspace isn't already open — if it's open,
      // VS Code/worktrees/terminals are already running locally and
      // a backend sync failure (e.g. offline) is harmless.
      if (workspace.status !== 'open') {
        toast('Failed to open workspace')
      }
    })
  }

  function handleCopyBranch() {
    ipc.clipboard.copy(workspace.branchName)
    toast('Branch name copied')
  }

  function handleClose() {
    openModal('close-workspace', { modal: 'close-workspace', workspaceId: workspace.id })
  }

  async function handleTogglePin() {
    const next = !workspace.isPinned
    onTogglePin(workspace.id, next)
    try {
      await ipc.workspaces.togglePin(workspace.id, next)
    } catch {
      onTogglePin(workspace.id, !next)
      toast('Failed to update pin')
    }
  }

  return (
    <div
      onClick={handleCardClick}
      className={[
        'group relative px-3 py-2.5 cursor-pointer select-none rounded-lg mx-1.5 mb-1',
        'border transition-all duration-150',
        isActive
          ? 'bg-surface-elevated border-border'
          : 'bg-surface-elevated border-border-subtle hover:border-border hover:bg-surface-elevated',
        isBroken ? 'opacity-50' : ''
      ].join(' ')}
    >
      {/* Active left border accent */}
      {isActive && (
        <div className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-brand" />
      )}

      {/* Top row — name + menu */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {isBroken && (
            <AlertTriangle size={12} className="text-warning shrink-0" />
          )}
          <span className="text-[13px] truncate font-medium text-fg">
            {workspace.name}
          </span>
          {workspace.isPinned && (
            <Pin size={10} className="text-brand fill-brand shrink-0" />
          )}
        </div>

        {/* Pin + ··· — both appear on hover */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); handleTogglePin() }}
            title={workspace.isPinned ? 'Unpin' : 'Pin to top'}
            className={[
              'flex items-center justify-center w-5 h-5 rounded transition-colors',
              workspace.isPinned
                ? 'text-brand hover:bg-surface-hover'
                : 'text-fg-tertiary hover:text-fg hover:bg-surface-hover'
            ].join(' ')}
          >
            <Pin size={12} className={workspace.isPinned ? 'fill-brand' : ''} />
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="flex items-center justify-center w-5 h-5 rounded text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-colors shrink-0"
              >
                <MoreHorizontal size={14} />
              </button>
            </DropdownMenuTrigger>

          <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem onSelect={handleCopyBranch}>
              <Copy size={13} className="shrink-0" />
              Copy branch name
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={handleClose}>
              <X size={13} className="shrink-0" />
              Close workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      </div>

      {/* Branch */}
      <div className="flex items-center gap-1.5 mt-1 min-w-0">
        <GitBranch size={11} className="text-fg-tertiary shrink-0" />
        <span className="text-[11px] text-fg-secondary truncate min-w-0">
          {workspace.branchName}
        </span>
      </div>

      {/* Process pills */}
      {hasProcesses && (
        <div className="flex flex-wrap gap-1 mt-2">
          {activeTerminals.map((terminal) => (
            <ProcessPill key={terminal.terminalId} terminal={terminal} />
          ))}
          {completedTerminals.map((terminal) => (
            <ProcessPill key={`done-${terminal.terminalId}`} terminal={terminal} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProcessPill({ terminal }: { terminal: WorkspaceTerminalEntry }) {
  const label = terminal.command ?? terminal.label

  if (terminal.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-brand/15 border border-brand/25 text-[11px] font-medium text-brand">
        <span className="w-1.5 h-1.5 rounded-full bg-brand animate-pulse-dot shrink-0" />
        {label}
      </span>
    )
  }

  if (terminal.status === 'idle') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-hover border border-border text-[11px] font-medium text-fg-secondary">
        <span className="w-1.5 h-1.5 rounded-full border border-fg-tertiary shrink-0" />
        {label}
      </span>
    )
  }

  if (terminal.status === 'completed') {
    const isSuccess = terminal.exitCode === 0
    const colorClasses = isSuccess
      ? 'bg-success/10 border-success/25 text-success'
      : 'bg-error/10 border-error/25 text-error'

    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-medium ${colorClasses}`}>
        {isSuccess ? <Check size={10} className="shrink-0" /> : <X size={10} className="shrink-0" />}
        {label}
      </span>
    )
  }

  return null
}

