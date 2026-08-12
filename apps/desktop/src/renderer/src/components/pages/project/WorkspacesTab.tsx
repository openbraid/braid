import { useCallback } from 'react'
import { GitBranch, Plus, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useWorkspaceStore } from '../../../store/workspace-store'
import { useUIStore } from '../../../store/ui-store'
import { ipc } from '../../../lib/ipc'
import { formatRelativeTime } from '../../../lib/format'
import { DataTable, type ColumnDef } from '../../common/DataTable'
import { WorkspaceLifecycleStatusPill } from '../../common/WorkspaceLifecycleStatusPill'
import type { WorkspaceWithLocal, WorkspaceLifecycleStatus } from '../../../../../shared/ipc-types'

// ─── Workspace table columns ─────────────────────────────────────────────────

function buildColumns(
  onLifecycleStatusChange: (workspaceId: string, status: WorkspaceLifecycleStatus) => void
): ColumnDef<WorkspaceWithLocal>[] {
  return [
    {
      id: 'name',
      header: 'Name',
      sortFn: (row) => row.name,
      cell: (row) => (
        <span className="text-[13px] font-medium text-fg truncate block">{row.name}</span>
      )
    },
    {
      id: 'branch',
      header: 'Branch',
      cell: (row) => (
        <div className="flex items-center gap-1.5 min-w-0">
          <GitBranch size={11} className="text-fg-tertiary shrink-0" />
          <span className="text-[12px] text-fg-secondary truncate">{row.branchName}</span>
        </div>
      )
    },
    {
      id: 'lifecycleStatus',
      header: 'Status',
      width: '130px',
      sortFn: (row) => row.lifecycleStatus,
      cell: (row) => (
        <div onClick={(e) => e.stopPropagation()}>
          <WorkspaceLifecycleStatusPill
            status={row.lifecycleStatus}
            changedByFirstName={row.lifecycleStatusChangedByFirstName}
            changedByLastName={row.lifecycleStatusChangedByLastName}
            changedAt={row.lifecycleStatusChangedAt}
            onStatusChange={(s) => onLifecycleStatusChange(row.id, s)}
          />
        </div>
      )
    },
    {
      id: 'lastOpenedAt',
      header: 'Last Opened',
      width: '140px',
      align: 'right',
      sortFn: (row) => row.lastOpenedAt ?? 0,
      cell: (row) => (
        <span className="text-[12px] text-fg-tertiary">
          {row.status === 'open' ? 'Now' : formatRelativeTime(row.lastOpenedAt)}
        </span>
      )
    },
    {
      id: 'owner',
      header: 'Owner',
      width: '100px',
      cell: (row) => (
        <span className="text-[12px] text-fg-secondary truncate block">{row.ownerName}</span>
      )
    }
  ]
}

// ─── Workspaces tab ──────────────────────────────────────────────────────────

export function WorkspacesTab({
  projectWorkspaces,
  projectId,
  onRowClick,
  onCreateClick,
  createDisabled = false,
  createDisabledReason
}: {
  projectWorkspaces: WorkspaceWithLocal[]
  projectId: string
  onRowClick: (ws: WorkspaceWithLocal) => void
  onCreateClick: () => void
  // When true, both "Create Workspace" entry points are disabled — e.g. project
  // isn't set up locally, so creation would fail anyway.
  createDisabled?: boolean
  createDisabledReason?: string
}) {
  const { updateWorkspace } = useWorkspaceStore()

  const handleLifecycleStatusChange = useCallback(
    async (workspaceId: string, lifecycleStatus: WorkspaceLifecycleStatus) => {
      const prev = projectWorkspaces.find((ws) => ws.id === workspaceId)?.lifecycleStatus
      updateWorkspace(workspaceId, { lifecycleStatus })
      try {
        await ipc.workspaces.updateLifecycleStatus(workspaceId, lifecycleStatus)
      } catch {
        if (prev) updateWorkspace(workspaceId, { lifecycleStatus: prev })
        toast('Failed to update workspace status')
      }
    },
    [projectWorkspaces, updateWorkspace]
  )

  const columns = buildColumns(handleLifecycleStatusChange)

  const hasWorkspaces = projectWorkspaces.length > 0

  // Empty state — first-run experience
  if (!hasWorkspaces) {
    return (
      <section className="flex items-center justify-center py-24">
        <div className="flex flex-col items-center text-center">
          <h3 className="text-[15px] font-medium text-fg">
            What's the first thing you want to build?
          </h3>
          <p className="text-[13px] text-fg-tertiary mt-1.5 mb-6 max-w-xs leading-relaxed">
            Every great feature starts with a workspace — your own isolated branch, your own VS Code, your own space to experiment freely.
          </p>
          <button
            onClick={onCreateClick}
            disabled={createDisabled}
            title={createDisabled ? createDisabledReason : undefined}
            className={[
              'flex items-center gap-2 px-5 py-2 rounded-lg text-[12px] font-medium text-white transition-colors',
              createDisabled
                ? 'bg-brand opacity-40 cursor-not-allowed'
                : 'bg-brand hover:bg-brand-hover cursor-pointer'
            ].join(' ')}
          >
            <Plus size={13} />
            Create Workspace
          </button>
          {createDisabled && createDisabledReason && (
            <p className="text-[11px] text-fg-tertiary mt-3 max-w-xs leading-relaxed">
              {createDisabledReason}
            </p>
          )}
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[13px] font-semibold text-fg">Workspaces</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => useUIStore.getState().openModal('invite-contributor', { modal: 'invite-contributor', projectId })}
            className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium text-fg-secondary hover:text-fg bg-surface border border-border hover:border-border-strong rounded-md transition-colors"
          >
            <UserPlus size={12} />
            Invite
          </button>
          <button
            onClick={onCreateClick}
            disabled={createDisabled}
            title={createDisabled ? createDisabledReason : undefined}
            className={[
              'flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-medium rounded-md transition-colors',
              createDisabled
                ? 'text-fg-tertiary bg-surface border border-border opacity-50 cursor-not-allowed'
                : 'text-fg-secondary hover:text-fg bg-surface border border-border hover:border-border-strong'
            ].join(' ')}
          >
            <Plus size={12} />
            New workspace
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={projectWorkspaces}
        rowKey={(ws) => ws.id}
        onRowClick={onRowClick}
        defaultSortId="lastOpenedAt"
        defaultSortDesc
      />
    </section>
  )
}
