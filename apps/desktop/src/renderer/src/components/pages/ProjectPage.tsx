import { useEffect, useState } from 'react'
import { AlertTriangle, FolderOpen } from 'lucide-react'
import { toast } from 'sonner'
import { useProjectStore } from '../../store/project-store'
import { useWorkspaceStore } from '../../store/workspace-store'
import { useUIStore } from '../../store/ui-store'
import { ipc } from '../../lib/ipc'
import type { ProjectSetupStatus, WorkspaceWithLocal } from '../../../../shared/ipc-types'
import { WorkspacesTab } from './project/WorkspacesTab'
import { SettingsTab } from './project/SettingsTab'

// ─── Tab types ───────────────────────────────────────────────────────────────

type ProjectTab = 'workspaces' | 'settings'

// ─── Component ───────────────────────────────────────────────────────────────

export function ProjectPage() {
  const projects = useProjectStore((s) => s.projects)
  const { workspaces, openTab, setActiveWorkspace, updateWorkspace } = useWorkspaceStore()
  const { openModal } = useUIStore()

  const activeProjectId = useWorkspaceStore((s) => s.activeProjectId)
  const project = projects.find((p) => p.id === activeProjectId)

  // Setup status lives in the store — kept fresh by App.tsx's PROJECT_UPDATED
  // listener AND by our own on-mount refresh below.
  const setupStatus = useProjectStore((s) =>
    activeProjectId ? (s.setupStatuses.get(activeProjectId) ?? null) : null
  )
  const refreshSetupStatus = useProjectStore((s) => s.refreshSetupStatus)

  const [activeTab, setActiveTab] = useState<ProjectTab>('workspaces')

  // Re-check filesystem truth on mount + project switch. The folder could have
  // been deleted outside Braid since we last looked.
  useEffect(() => {
    if (!activeProjectId) return
    refreshSetupStatus(activeProjectId)
  }, [activeProjectId, refreshSetupStatus])

  if (!project) return null

  const projectWorkspaces = workspaces.filter((ws) => ws.projectId === project.id)
  const needsSetup = setupStatus?.status === 'not-setup' || setupStatus?.status === 'missing'

  async function handleRowClick(ws: WorkspaceWithLocal) {
    if (ws.status === 'broken') {
      openModal('broken-workspace', { modal: 'broken-workspace', workspaceId: ws.id })
      return
    }
    if (ws.status === 'open') {
      openTab(ws.id)
      setActiveWorkspace(ws.id)
      return
    }
    // closed — reopen optimistically
    const prevStatus = ws.status
    openTab(ws.id)
    setActiveWorkspace(ws.id)
    updateWorkspace(ws.id, { status: 'open' })
    try {
      await ipc.workspaces.reopen(ws.id)
    } catch {
      updateWorkspace(ws.id, { status: prevStatus })
      toast('Failed to reopen workspace')
    }
  }

  const tabs: { id: ProjectTab; label: string }[] = [
    { id: 'workspaces', label: 'Workspaces' },
    { id: 'settings', label: 'Settings' }
  ]

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-8">

        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2.5">
            <h1 className="text-[22px] font-semibold text-fg tracking-tight">{project.name}</h1>
            {needsSetup && (
              <span className="text-[11px] font-medium text-warning bg-warning/10 border border-warning/30 rounded-full px-2 py-0.5">
                Not set up locally
              </span>
            )}
          </div>
          {project.localPath && !needsSetup && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <FolderOpen size={12} className="text-fg-tertiary shrink-0" />
              <span className="text-[12px] text-fg-tertiary font-mono truncate">{project.localPath}</span>
            </div>
          )}
        </div>

        {/* Setup callout — clicking opens SetupProjectModal */}
        {needsSetup && setupStatus && (
          <ProjectSetupCallout
            status={setupStatus}
            onSetup={() => openModal('setup-project', { modal: 'setup-project', projectId: project.id })}
          />
        )}

        {/* Tabs */}
        <div className="flex items-center gap-6 border-b border-border-subtle mb-6">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={[
                'pb-2.5 text-[13px] font-medium transition-colors relative flex items-center gap-1.5',
                activeTab === tab.id
                  ? 'text-fg'
                  : 'text-fg-tertiary hover:text-fg-secondary'
              ].join(' ')}
            >
              {tab.label}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand rounded-full" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === 'workspaces' && (
          <WorkspacesTab
            projectWorkspaces={projectWorkspaces}
            projectId={project.id}
            onRowClick={handleRowClick}
            onCreateClick={() => openModal('create-workspace', { modal: 'create-workspace', projectId: project.id })}
            createDisabled={needsSetup}
            createDisabledReason={needsSetup ? 'Set up the project locally first.' : undefined}
          />
        )}
        {activeTab === 'settings' && (
          <SettingsTab projectId={project.id} />
        )}

      </div>
    </div>
  )
}

// ─── Setup callout card ──────────────────────────────────────────────────────

function ProjectSetupCallout({
  status,
  onSetup
}: {
  status: ProjectSetupStatus
  onSetup: () => void
}) {
  if (status.status === 'setup') return null

  const title = status.status === 'not-setup'
    ? "This project isn't set up on your machine yet"
    : 'Local files for this project are missing'

  const description = status.status === 'not-setup'
    ? 'Clone the repositories locally to create workspaces and open them in VS Code.'
    : status.localPathExists
      ? `Can't find: ${status.missingRepoNames.join(', ')}. Re-clone to continue.`
      : `Folder "${status.localPath}" is gone. Re-clone to continue.`

  const cta = status.status === 'not-setup' ? 'Set up locally' : 'Restore setup'

  return (
    <div className="mb-6 flex items-start gap-3 px-4 py-3.5 rounded-lg bg-warning/5 border border-warning/30">
      <AlertTriangle size={16} className="text-warning shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-fg">{title}</p>
        <p className="text-[12px] text-fg-secondary mt-0.5 leading-relaxed">{description}</p>
      </div>
      <button
        onClick={onSetup}
        className="shrink-0 px-3 py-1.5 rounded-md text-[12px] font-medium text-white bg-brand hover:bg-brand-hover transition-colors"
      >
        {cta}
      </button>
    </div>
  )
}
