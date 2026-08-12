import { PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react'
import { BraidMark } from '../ui/BraidMark'
import { useProjectStore } from '../../store/project-store'
import { useWorkspaceStore } from '../../store/workspace-store'
import { useUIStore } from '../../store/ui-store'
import { ipc } from '../../lib/ipc'
import { ProjectSection } from './ProjectSection'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/Tooltip'
import { ModeIndicator } from './ModeIndicator'

export function NavigationSideBar() {
  const projects = useProjectStore((s) => s.projects)
  const setActiveView = useWorkspaceStore((s) => s.setActiveView)
  const { leftPanelCollapsed, setLeftPanelCollapsed, openModal } = useUIStore()

  function toggleCollapsed() {
    const next = !leftPanelCollapsed
    setLeftPanelCollapsed(next)
    ipc.app.setState({ leftPanelCollapsed: next })
  }

  return (
    <div
      className={[
        'flex flex-col h-full bg-surface border-r border-border-subtle shrink-0',
        'transition-all duration-150 overflow-hidden',
        leftPanelCollapsed ? 'w-11' : 'w-60'
      ].join(' ')}
    >
      {/* Top bar */}
      {leftPanelCollapsed ? (
        <div className="flex flex-col items-center pt-1 pb-1 shrink-0">
          <button
            onClick={() => setActiveView('home')}
            className="flex items-center justify-center w-7 h-7 rounded hover:bg-surface-hover transition-colors"
          >
            <BraidMark size={20} />
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between h-9 px-3 shrink-0">
          <button
            onClick={() => setActiveView('home')}
            className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
          >
            <BraidMark size={20} />
            <span className="font-medium text-fg text-[13px] truncate">Braid</span>
          </button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => openModal('add-project')}
                className="flex items-center justify-center w-6 h-6 rounded text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
              >
                <Plus size={13} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Create project</TooltipContent>
          </Tooltip>
        </div>
      )}

      <div className="h-px bg-border-subtle shrink-0" />

      {/* Project list — scrollable */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        {projects.map((project) => (
          <ProjectSection key={project.id} project={project} collapsed={leftPanelCollapsed} />
        ))}
      </div>

      {/* Bottom bar */}
      <div className="shrink-0 px-2 py-1 flex items-center justify-between gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={toggleCollapsed}
              className="flex items-center justify-center w-7 h-7 rounded text-fg-secondary hover:text-fg hover:bg-surface-hover transition-colors"
            >
              {leftPanelCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {leftPanelCollapsed ? 'Expand panel' : 'Collapse panel'}
          </TooltipContent>
        </Tooltip>

        <ModeIndicator collapsed={leftPanelCollapsed} />
      </div>
    </div>
  )
}
