import { useCallback, useMemo, useState } from 'react'
import { ChevronDown, GitBranch, Plus } from 'lucide-react'
import { BraidMark } from '../ui/BraidMark'
import { toast } from 'sonner'
import { useAuthStore } from '../../store/auth-store'
import { useProjectStore } from '../../store/project-store'
import { useWorkspaceStore } from '../../store/workspace-store'
import { useUIStore } from '../../store/ui-store'
import { ipc } from '../../lib/ipc'
import { formatRelativeTime } from '../../lib/format'
import { DataTable, type ColumnDef } from '../common/DataTable'
import { WorkspaceLifecycleStatusPill, getLifecycleStatusConfig } from '../common/WorkspaceLifecycleStatusPill'
import type { WorkspaceWithLocal, WorkspaceLifecycleStatus, ProjectWithRepos } from '../../../../shared/ipc-types'

// ─── Constants ───────────────────────────────────────────────────────────────

const LIFECYCLE_OPTIONS: { value: WorkspaceLifecycleStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All statuses' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' }
]

const DASHBOARD_PAGE_SIZE = 7

// ─── Workspace table columns ─────────────────────────────────────────────────

function buildColumns(
  projectNameMap: Map<string, string>,
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
      id: 'project',
      header: 'Project',
      sortFn: (row) => projectNameMap.get(row.projectId) ?? '',
      cell: (row) => (
        <span className="text-[12px] text-fg-secondary truncate block">
          {projectNameMap.get(row.projectId) ?? ''}
        </span>
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
      id: 'owner',
      header: 'Owner',
      width: '100px',
      cell: (row) => (
        <span className="text-[12px] text-fg-secondary truncate block">{row.ownerName}</span>
      )
    },
    {
      id: 'createdAt',
      header: 'Created',
      width: '120px',
      align: 'right',
      sortFn: (row) => row.createdAt,
      cell: (row) => (
        <span className="text-[12px] text-fg-tertiary">
          {formatRelativeTime(row.createdAt)}
        </span>
      )
    }
  ]
}

// ─── Project card ────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  workspaces,
  onClick
}: {
  project: ProjectWithRepos
  workspaces: WorkspaceWithLocal[]
  onClick: () => void
}) {
  const openCount = workspaces.filter((ws) => ws.status === 'open').length

  // Build lifecycle status summary — only non-zero counts
  const statusCounts = useMemo(() => {
    const counts = new Map<WorkspaceLifecycleStatus, number>()
    for (const ws of workspaces) {
      counts.set(ws.lifecycleStatus, (counts.get(ws.lifecycleStatus) ?? 0) + 1)
    }
    return (['in_progress', 'blocked', 'on_hold', 'completed'] as WorkspaceLifecycleStatus[])
      .map((status) => ({ status, count: counts.get(status) ?? 0 }))
      .filter(({ count }) => count > 0)
  }, [workspaces])

  // Repo names — truncated list
  const repoNames = project.repos.map((r) => r.name).join(' · ')

  return (
    <button
      onClick={onClick}
      className="text-left bg-surface-elevated border border-border-subtle rounded-lg p-5 cursor-pointer hover:border-border transition-colors w-full"
    >
      <h3 className="text-[14px] font-medium text-fg truncate">{project.name}</h3>

      {repoNames && (
        <p className="text-[11px] text-fg-tertiary mt-1 truncate">{repoNames}</p>
      )}

      <div className="flex items-center gap-3 mt-3">
        <span className="text-[12px] text-fg-secondary">
          {workspaces.length} {workspaces.length === 1 ? 'workspace' : 'workspaces'}
        </span>
        {openCount > 0 && (
          <span className="text-[12px] text-fg-tertiary">
            {openCount} open
          </span>
        )}
      </div>

      {statusCounts.length > 0 && (
        <div className="flex items-center gap-3 mt-2">
          {statusCounts.map(({ status, count }) => {
            const config = getLifecycleStatusConfig(status)
            return (
              <div key={status} className="flex items-center gap-1">
                <div className={`w-1.5 h-1.5 rounded-full ${config.dotClass}`} />
                <span className="text-[11px] text-fg-tertiary">
                  {count} {config.label.toLowerCase()}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </button>
  )
}

// ─── Welcome screen (zero projects) ─────────────────────────────────────────

const ONBOARDING_STEPS = [
  {
    title: 'Point to your code',
    description:
      'Select the folder where your project lives. Single repo or multiple — Braid handles both.'
  },
  {
    title: 'Start a workspace',
    description:
      'Every feature or bug gets its own isolated branch, its own VS Code, its own AI agents. Run as many as you need — track them all from one sidebar.'
  },
  {
    title: 'Build with full context',
    description:
      'Your AI agents capture decisions as artifacts — requirements, designs, specs — that the whole team can see, review, and build on. Nothing gets lost.'
  }
]

function WelcomeScreen({ onAddProject }: { onAddProject: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8 select-text">
      <div className="flex flex-col items-center w-full max-w-md">
        {/* Logo + heading */}
        <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-surface border border-border-subtle">
          <BraidMark size={28} />
        </div>
        <h1 className="text-[22px] font-semibold text-fg tracking-tight mt-5 text-center">
          Welcome to Braid
        </h1>

        {/* Steps */}
        <div className="w-full mt-8 space-y-6">
          {ONBOARDING_STEPS.map((step, i) => (
            <div key={i} className="flex gap-3.5">
              <span className="text-[13px] font-semibold text-brand tabular-nums shrink-0 mt-px">{i + 1}.</span>
              <div>
                <h3 className="text-[14px] font-medium text-fg">{step.title}</h3>
                <p className="text-[13px] text-fg-secondary mt-1 leading-relaxed">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="w-full mt-8 pt-7 border-t border-border-subtle flex flex-col items-center gap-3">
          <button
            onClick={onAddProject}
            className="flex items-center gap-2 px-5 py-2 rounded-md bg-brand text-white text-[13px] font-semibold hover:bg-brand-hover transition-colors select-none"
          >
            <Plus size={14} />
            Add Your First Project
          </button>
          <p className="text-[11px] text-fg-tertiary">
            Select a folder containing one or more git repos
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── Filter dropdown (reusable) ─────────────────────────────────────────────

function FilterDropdown<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}) {
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[12px] text-fg-secondary bg-surface border border-border hover:border-border-strong transition-colors"
      >
        {current?.label}
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 w-44 bg-surface-elevated border border-border rounded-lg shadow-lg py-1 z-50">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setOpen(false) }}
                className={[
                  'w-full text-left px-3 py-1.5 text-[12px] transition-colors',
                  opt.value === value ? 'text-fg bg-surface-hover' : 'text-fg-secondary hover:text-fg hover:bg-surface-hover'
                ].join(' ')}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Dashboard (main export) ─────────────────────────────────────────────────

export function HomePage() {
  const user = useAuthStore((s) => s.user)
  const projects = useProjectStore((s) => s.projects)
  const { workspaces, openTab, setActiveWorkspace, setActiveView, setActiveProjectId, updateWorkspace } = useWorkspaceStore()
  const { openModal } = useUIStore()

  const [statusFilter, setStatusFilter] = useState<WorkspaceLifecycleStatus | 'all'>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')

  // Workspaces grouped by project (for project cards)
  const workspacesByProject = new Map<string, WorkspaceWithLocal[]>()
  for (const ws of workspaces) {
    const list = workspacesByProject.get(ws.projectId) ?? []
    list.push(ws)
    workspacesByProject.set(ws.projectId, list)
  }

  // Filter workspaces
  const filteredWorkspaces = workspaces.filter((ws) => {
    if (statusFilter !== 'all' && ws.lifecycleStatus !== statusFilter) return false
    if (projectFilter !== 'all' && ws.projectId !== projectFilter) return false
    return true
  })

  // Project filter options
  const projectFilterOptions: { value: string; label: string }[] = [
    { value: 'all', label: 'All projects' },
    ...projects.map((p) => ({ value: p.id, label: p.name }))
  ]

  // Workspace row click — same pattern as ProjectPage
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

  // Lifecycle status change — optimistic update
  const handleLifecycleStatusChange = useCallback(
    async (workspaceId: string, lifecycleStatus: WorkspaceLifecycleStatus) => {
      const prev = workspaces.find((ws) => ws.id === workspaceId)?.lifecycleStatus
      updateWorkspace(workspaceId, { lifecycleStatus })
      try {
        await ipc.workspaces.updateLifecycleStatus(workspaceId, lifecycleStatus)
      } catch {
        if (prev) updateWorkspace(workspaceId, { lifecycleStatus: prev })
        toast('Failed to update workspace status')
      }
    },
    [workspaces, updateWorkspace]
  )

  // Zero-projects → welcome / onboarding (must be after all hooks)
  if (projects.length === 0) {
    return <WelcomeScreen onAddProject={() => openModal('add-project')} />
  }

  // Build project name lookup
  const projectNameMap = new Map(projects.map((p) => [p.id, p.name]))

  const columns = buildColumns(projectNameMap, handleLifecycleStatusChange)

  function handleProjectClick(projectId: string) {
    setActiveView('project')
    setActiveProjectId(projectId)
  }

  const greeting = user?.firstName ? `Hey ${user.firstName}!` : 'Hey!'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-10 py-8 max-w-[1200px]">

        {/* Greeting */}
        <div className="mb-8">
          <h1 className="text-[22px] font-semibold text-fg tracking-tight">{greeting}</h1>
          <p className="text-[13px] text-fg-secondary mt-1.5">Ready to ship something great?</p>
        </div>

        {/* Workspaces section */}
        <section className="bg-surface-secondary rounded-lg mb-6">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="text-[13px] font-semibold text-fg">Workspaces</h2>
            <div className="flex items-center gap-2">
              <FilterDropdown
                value={projectFilter}
                options={projectFilterOptions}
                onChange={setProjectFilter}
              />
              <FilterDropdown
                value={statusFilter}
                options={LIFECYCLE_OPTIONS}
                onChange={setStatusFilter}
              />
            </div>
          </div>
          <div className="px-5 pb-4">
            <DataTable
              columns={columns}
              data={filteredWorkspaces}
              rowKey={(ws) => ws.id}
              onRowClick={handleRowClick}
              defaultSortId="createdAt"
              defaultSortDesc
              pageSize={DASHBOARD_PAGE_SIZE}
              emptyState={
                <div className="flex items-center justify-center py-12">
                  <p className="text-[13px] text-fg-tertiary">
                    {statusFilter === 'all' && projectFilter === 'all'
                      ? 'No workspaces yet'
                      : 'No workspaces match these filters'}
                  </p>
                </div>
              }
            />
          </div>
        </section>

        {/* Projects section */}
        <section className="bg-surface-secondary rounded-lg">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="text-[13px] font-semibold text-fg">Projects</h2>
            <button
              onClick={() => openModal('add-project')}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[12px] font-medium text-fg-secondary hover:text-fg bg-surface border border-border hover:border-border-strong rounded-md transition-colors"
            >
              <Plus size={12} />
              Add Project
            </button>
          </div>
          <div className="px-5 pb-5">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects
                .slice()
                .sort((a, b) => b.createdAt - a.createdAt)
                .map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    workspaces={workspacesByProject.get(project.id) ?? []}
                    onClick={() => handleProjectClick(project.id)}
                  />
                ))}
            </div>
          </div>
        </section>

      </div>
    </div>
  )
}
