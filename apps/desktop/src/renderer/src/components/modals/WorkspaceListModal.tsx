import * as Dialog from '@radix-ui/react-dialog'
import { GitBranch, X } from 'lucide-react'
import { useWorkspaceStore } from '../../store/workspace-store'
import { useUIStore } from '../../store/ui-store'
import { useProjectStore } from '../../store/project-store'
import { ipc } from '../../lib/ipc'
import { formatRelativeTime } from '../../lib/format'
import { DataTable, type ColumnDef } from '../common/DataTable'
import { getLifecycleStatusConfig } from '../common/WorkspaceLifecycleStatusPill'
import type { WorkspaceWithLocal } from '../../../../shared/ipc-types'

// ─── Column definitions ───────────────────────────────────────────────────────

const columns: ColumnDef<WorkspaceWithLocal>[] = [
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
    width: '120px',
    sortFn: (row) => row.lifecycleStatus,
    cell: (row) => {
      const config = getLifecycleStatusConfig(row.lifecycleStatus)
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-fg-secondary">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${config.dotClass}`} />
          {config.label}
        </span>
      )
    }
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

// ─── Component ────────────────────────────────────────────────────────────────

export function WorkspaceListModal() {
  const { closeModal, modalContext, openModal } = useUIStore()
  const { workspaces, openTab, setActiveWorkspace, updateWorkspace } = useWorkspaceStore()
  const projects = useProjectStore((s) => s.projects)

  const projectId = modalContext?.modal === 'workspace-list' ? modalContext.projectId : undefined
  const project = projectId ? projects.find((p) => p.id === projectId) : undefined

  const allWorkspaces = projectId
    ? workspaces.filter((ws) => ws.projectId === projectId)
    : workspaces

  async function handleRowClick(ws: WorkspaceWithLocal) {
    if (ws.status === 'broken') {
      closeModal()
      openModal('broken-workspace', { modal: 'broken-workspace', workspaceId: ws.id })
      return
    }

    if (ws.status === 'open') {
      openTab(ws.id)
      setActiveWorkspace(ws.id)
      closeModal()
      return
    }

    // closed_with_files or closed_clean — reopen
    // Optimistically open tab and navigate; WORKSPACE_UPDATED push will patch status
    openTab(ws.id)
    setActiveWorkspace(ws.id)
    updateWorkspace(ws.id, { status: 'open' })
    closeModal()
    ipc.workspaces.reopen(ws.id)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) closeModal() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-[680px] max-h-[520px] bg-surface border border-border rounded-xl shadow-2xl flex flex-col outline-none">

          {/* Header */}
          <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border-subtle shrink-0">
            <div>
              <Dialog.Title className="text-[15px] font-semibold text-fg">
                {project ? project.name : 'All Workspaces'}
              </Dialog.Title>
              {project && (
                <p className="text-[12px] text-fg-tertiary mt-0.5">{project.localPath}</p>
              )}
            </div>
            <button
              onClick={closeModal}
              className="flex items-center justify-center w-7 h-7 rounded-md text-fg-tertiary hover:text-fg hover:bg-surface-hover transition-colors"
            >
              <X size={15} />
            </button>
          </div>

          {/* Table */}
          <div className="overflow-y-auto flex-1 px-2 py-2">
            <DataTable
              columns={columns}
              data={allWorkspaces}
              rowKey={(ws) => ws.id}
              onRowClick={handleRowClick}
              defaultSortId="lastOpenedAt"
              defaultSortDesc
              pageSize={8}
              emptyState={
                <div className="py-12 text-center text-[13px] text-fg-tertiary">
                  No workspaces yet
                </div>
              }
            />
          </div>

        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
