import { useState, useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, LayoutList, Plus } from 'lucide-react'
import type { ProjectWithRepos, WorkspaceWithLocal } from '../../../../shared/ipc-types'
import { useWorkspaceStore } from '../../store/workspace-store'
import { useUIStore } from '../../store/ui-store'
import { ipc } from '../../lib/ipc'
import { WorkspaceCard } from './WorkspaceCard'
import { ProjectSectionCollapsed } from './ProjectSectionCollapsed'

type Props = {
  project: ProjectWithRepos
  collapsed: boolean
}

function isVisible(ws: WorkspaceWithLocal) {
  return ws.status === 'open' || ws.status === 'broken'
}

/**
 * Initial sort — runs once on mount.
 * Pinned first (lastOpenedAt DESC), then unpinned (lastOpenedAt DESC), broken always last.
 * lastOpenedAt reflects the most recent time the user clicked/opened a workspace,
 * so on restart the order matches the user's most recent usage pattern.
 */
function sortOnce(workspaces: WorkspaceWithLocal[]): WorkspaceWithLocal[] {
  const byRecency = (a: WorkspaceWithLocal, b: WorkspaceWithLocal) =>
    (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0)
  const pinned = workspaces.filter((ws) => ws.isPinned && ws.status !== 'broken').sort(byRecency)
  const unpinned = workspaces.filter((ws) => !ws.isPinned && ws.status !== 'broken').sort(byRecency)
  const broken = workspaces.filter((ws) => ws.status === 'broken').sort(byRecency)
  return [...pinned, ...unpinned, ...broken]
}

export function ProjectSection({ project, collapsed }: Props) {
  const { workspaces, activeWorkspaceId, activeView, activeProjectId, setActiveWorkspace, setActiveView, setActiveProjectId, updateWorkspace, setSidebarOrder } =
    useWorkspaceStore()
  const isProjectPageActive = activeView === 'project' && activeProjectId === project.id
  const { openModal, collapsedProjectIds, setCollapsedProjectIds } = useUIStore()
  const isProjectCollapsed = collapsedProjectIds.has(project.id)

  // Ordered list — sorted once on mount, then updated surgically
  const [orderedWorkspaces, setOrderedWorkspaces] = useState<WorkspaceWithLocal[]>(() => {
    const visible = workspaces.filter((ws) => ws.projectId === project.id && isVisible(ws))
    return sortOnce(visible)
  })

  // Persist initial order to the store on mount (must be in useEffect, not during render)
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      setSidebarOrder(project.id, orderedWorkspaces.map((ws) => ws.id))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Track previous IDs to detect additions/removals without full re-sort
  const prevIdsRef = useRef<Set<string>>(new Set(orderedWorkspaces.map((ws) => ws.id)))

  useEffect(() => {
    const storeVisible = workspaces.filter((ws) => ws.projectId === project.id && isVisible(ws))
    const storeById = new Map(storeVisible.map((ws) => [ws.id, ws]))
    const prevIds = prevIdsRef.current

    setOrderedWorkspaces((prev) => {
      let updated = prev

      // Step 1: Remove workspaces no longer visible
      updated = updated.filter((ws) => storeById.has(ws.id))

      // Step 2: Patch fields in-place; collect workspaces whose isPinned changed
      const pinChanged: string[] = []
      updated = updated.map((ws) => {
        const fresh = storeById.get(ws.id)
        if (!fresh) return ws
        if (fresh.isPinned !== ws.isPinned) pinChanged.push(ws.id)
        return { ...ws, ...fresh }
      })

      // Step 3: Reposition workspaces whose isPinned flipped
      for (const id of pinChanged) {
        const ws = updated.find((w) => w.id === id)!
        updated = updated.filter((w) => w.id !== id)
        if (ws.isPinned) {
          // Pinned → move to front
          updated = [ws, ...updated]
        } else {
          // Unpinned → insert right after last pinned (before first unpinned non-broken)
          const insertAt = updated.findIndex((w) => !w.isPinned && w.status !== 'broken')
          if (insertAt === -1) {
            updated = [ws, ...updated]
          } else {
            updated = [...updated.slice(0, insertAt), ws, ...updated.slice(insertAt)]
          }
        }
      }

      // Step 4: Insert new workspaces right after last pinned
      const currentIds = new Set(updated.map((w) => w.id))
      const newWorkspaces = storeVisible.filter((ws) => !prevIds.has(ws.id) && !currentIds.has(ws.id))
      for (const newWs of newWorkspaces) {
        const insertAt = updated.findIndex((w) => !w.isPinned && w.status !== 'broken')
        if (insertAt === -1) {
          updated = [newWs, ...updated]
        } else {
          updated = [...updated.slice(0, insertAt), newWs, ...updated.slice(insertAt)]
        }
      }

      prevIdsRef.current = new Set(updated.map((w) => w.id))
      // Keep the store in sync with the visual order
      setSidebarOrder(project.id, updated.map((w) => w.id))
      return updated
    })
  }, [workspaces, project.id, setSidebarOrder])

  if (collapsed) {
    return <ProjectSectionCollapsed project={project} openWorkspaces={orderedWorkspaces} />
  }

  function handleProjectClick() {
    setActiveView('project')
    setActiveProjectId(project.id)
  }

  function handleToggleCollapsed() {
    const next = new Set(collapsedProjectIds)
    if (isProjectCollapsed) next.delete(project.id)
    else next.add(project.id)
    const nextArr = [...next]
    setCollapsedProjectIds(nextArr)
    // Persist so the collapse state survives restarts.
    ipc.app.setState({ collapsedProjectIds: nextArr })
  }

  function handleTogglePin(workspaceId: string, isPinned: boolean) {
    updateWorkspace(workspaceId, { isPinned })
  }

  return (
    <div className="mb-2">
      {/* Project header */}
      <div className="flex items-center justify-between pl-1 pr-3 pt-2 pb-1 group">
        <button
          onClick={handleToggleCollapsed}
          className="flex items-center justify-center w-4 h-4 shrink-0 rounded text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-colors"
          title={isProjectCollapsed ? 'Expand' : 'Collapse'}
        >
          {isProjectCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <span
          onClick={handleProjectClick}
          className={[
            'text-[11px] font-semibold uppercase tracking-wider cursor-pointer hover:text-fg transition-colors truncate min-w-0 flex-1 ml-1',
            isProjectPageActive ? 'text-brand' : 'text-fg-secondary'
          ].join(' ')}
        >
          {project.name}
        </span>
        <div className="flex items-center gap-0.5 shrink-0 ml-1">
          <button
            onClick={() => openModal('workspace-list', { modal: 'workspace-list', projectId: project.id })}
            className="flex items-center justify-center w-5 h-5 rounded text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-colors"
            title="All workspaces"
          >
            <LayoutList size={13} />
          </button>
          <button
            onClick={() => openModal('create-workspace', { modal: 'create-workspace', projectId: project.id })}
            className="flex items-center justify-center w-5 h-5 rounded text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-colors"
            title="New workspace"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      {/* Workspace cards — hidden when the project is collapsed */}
      {!isProjectCollapsed && orderedWorkspaces.map((ws) => (
        <WorkspaceCard
          key={ws.id}
          workspace={ws}
          isActive={activeView === 'workspace' && ws.id === activeWorkspaceId}
          isBroken={ws.status === 'broken'}
          onActivate={() => setActiveWorkspace(ws.id)}
          onTogglePin={handleTogglePin}
        />
      ))}
    </div>
  )
}
