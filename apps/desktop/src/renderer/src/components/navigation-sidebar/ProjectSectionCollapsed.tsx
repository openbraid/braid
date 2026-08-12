import type { ProjectWithRepos, WorkspaceWithLocal, TerminalEntry } from '../../../../shared/ipc-types'
import { useTerminalStore } from '../../store/terminal-store'
import { useWorkspaceStore } from '../../store/workspace-store'
import { useUIStore } from '../../store/ui-store'
import { ipc } from '../../lib/ipc'
import { Plus } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'

const EMPTY_TERMINALS: TerminalEntry[] = []

type Props = {
  project: ProjectWithRepos
  openWorkspaces: WorkspaceWithLocal[]
}

type StatusDotProps = {
  workspaceId: string
  isBroken: boolean
}

function StatusDot({ workspaceId, isBroken }: StatusDotProps) {
  const terminals = useTerminalStore((s) => s.terminals.get(workspaceId) ?? EMPTY_TERMINALS)

  if (isBroken) {
    return <span className="absolute bottom-1 right-1.5 w-1.5 h-1.5 rounded-full bg-warning" />
  }

  const hasWaiting = terminals.some((t) => t.status === 'waiting')
  const hasRunning = terminals.some((t) => t.status === 'running')

  if (hasWaiting) {
    return <span className="absolute bottom-1 right-1.5 w-1.5 h-1.5 rounded-full bg-brand" />
  }
  if (hasRunning) {
    return (
      <span className="absolute bottom-1 right-1.5 w-1.5 h-1.5 rounded-full bg-brand animate-pulse-dot" />
    )
  }
  return null
}

export function ProjectSectionCollapsed({ project, openWorkspaces }: Props) {
  const { activeWorkspaceId, activeView, setActiveWorkspace } = useWorkspaceStore()
  const { openModal } = useUIStore()

  function handleClick(ws: WorkspaceWithLocal, isBroken: boolean) {
    if (isBroken) {
      openModal('broken-workspace', { modal: 'broken-workspace', workspaceId: ws.id })
      return
    }
    ipc.workspaces.open(ws.id)
    setActiveWorkspace(ws.id)
  }

  return (
    <div className="pt-1.5 pb-1.5">
      {openWorkspaces.map((ws) => {
        const isBroken = false // wired in M5.1
        const isActive = activeView === 'workspace' && ws.id === activeWorkspaceId

        return (
          <Tooltip key={ws.id} delayDuration={200}>
            <TooltipTrigger asChild>
              <div
                onClick={() => handleClick(ws, isBroken)}
                className={[
                  'relative flex items-center justify-center h-8 cursor-pointer rounded-md mx-1.5 mb-0.5',
                  'border transition-colors',
                  isActive
                    ? 'bg-surface-elevated border-border'
                    : 'bg-surface-elevated border-border-subtle hover:border-border'
                ].join(' ')}
              >
                {isActive && (
                  <div className="absolute left-0 top-1 bottom-1 w-[3px] rounded-full bg-brand" />
                )}
                <span className="text-[13px] font-medium text-fg-secondary">
                  {ws.name[0].toUpperCase()}
                </span>
                <StatusDot workspaceId={ws.id} isBroken={isBroken} />
              </div>
            </TooltipTrigger>
            <TooltipContent side="right">
              {ws.name} · {ws.branchName}
            </TooltipContent>
          </Tooltip>
        )
      })}

      {/* New workspace button */}
      <Tooltip delayDuration={200}>
        <TooltipTrigger asChild>
          <button
            onClick={() => openModal('create-workspace', { modal: 'create-workspace', projectId: project.id })}
            className="flex items-center justify-center w-8 h-8 mx-1.5 rounded-md text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-colors"
          >
            <Plus size={13} />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">New workspace · {project.name}</TooltipContent>
      </Tooltip>

      {/* Divider between projects */}
      <div className="h-px bg-border-subtle mx-2 mt-1" />
    </div>
  )
}
