import { Code2, Layers, MessagesSquare } from 'lucide-react'
import { useWorkspaceStore } from '../../store/workspace-store'
import { useWorkspaceViewStore, type WorkspaceTab } from '../../store/workspace-view-store'
import { WorkspaceTabPill } from './WorkspaceTabPill'
import { WorkspaceLifecycleStatusPill } from '../common/WorkspaceLifecycleStatusPill'
import type { WorkspaceLifecycleStatus } from '../../../../shared/ipc-types'
import { ipc } from '../../lib/ipc'
import { toast } from 'sonner'
import { track } from '../../lib/analytics'

const TABS: { tab: WorkspaceTab; label: string; icon: React.ReactNode }[] = [
  { tab: 'code',      label: 'Code',      icon: <Code2           size={14} /> },
  { tab: 'artifacts', label: 'Artifacts', icon: <Layers          size={14} /> },
  { tab: 'sessions',  label: 'Sessions',  icon: <MessagesSquare  size={14} /> },
]

export function WorkspaceTabBar() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((ws) => ws.id === activeWorkspaceId)
  )
  const updateWorkspace = useWorkspaceStore((s) => s.updateWorkspace)
  const activeTab = useWorkspaceViewStore((s) =>
    activeWorkspaceId ? (s.views.get(activeWorkspaceId)?.activeTab ?? 'code') : 'code'
  )

  async function handleLifecycleStatusChange(nextStatus: WorkspaceLifecycleStatus) {
    if (!workspace) return
    const prevStatus = workspace.lifecycleStatus
    updateWorkspace(workspace.id, { lifecycleStatus: nextStatus })
    try {
      await ipc.workspaces.updateLifecycleStatus(workspace.id, nextStatus)
    } catch {
      updateWorkspace(workspace.id, { lifecycleStatus: prevStatus })
      toast('Failed to update workspace status')
    }
  }

  return (
    <div className="h-9 shrink-0 flex items-center gap-1 px-3 bg-surface border-b border-border-subtle">
      {TABS.map(({ tab, label, icon }) => (
        <WorkspaceTabPill
          key={tab}
          tab={tab}
          icon={icon}
          label={label}
          isActive={activeTab === tab}
          onClick={() => {
            if (!activeWorkspaceId) return
            if (tab === 'artifacts') track('artifact_tab_viewed')
            useWorkspaceViewStore.getState().setActiveTab(activeWorkspaceId, tab)
          }}
        />
      ))}

      <div className="flex-1" />

      {workspace && (
        <WorkspaceLifecycleStatusPill
          status={workspace.lifecycleStatus}
          changedByFirstName={workspace.lifecycleStatusChangedByFirstName}
          changedByLastName={workspace.lifecycleStatusChangedByLastName}
          changedAt={workspace.lifecycleStatusChangedAt}
          onStatusChange={handleLifecycleStatusChange}
        />
      )}
    </div>
  )
}
