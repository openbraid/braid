import { integer, sqliteTable, text, index, primaryKey } from 'drizzle-orm/sqlite-core'

// ─── Cloud Layer ──────────────────────────────────────────────────────────────
// Machine-agnostic entities. In local mode these are the source of truth and
// live here in SQLite. In team mode the same entities live in core-api's
// PostgreSQL and these tables are unused — the Backend* repositories are
// selected instead. See repositories/index.ts.
//
// Column names and shapes mirror core-api's Prisma schema on purpose: IDs are
// client-generated UUIDs in both, so promoting a local project to a server is
// an upsert rather than an ID remap.

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // Settings live on the project row here exactly as they do on core-api's
  // Project model — same names, same defaults — so the two stay swappable.
  artifactsEnabled: integer('artifacts_enabled').notNull().default(1),
  // JSON array of agent IDs, matching the server's encoding.
  selectedAgents: text('selected_agents').notNull().default('[]'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const repositories = sqliteTable('repositories', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  // A repo is identified permanently by its remote, never by its local path.
  // The constraint is what lets the same repo be shared across projects.
  remoteUrl: text('remote_url').notNull().unique(),
  createdAt: integer('created_at').notNull()
})

export const projectRepositories = sqliteTable(
  'project_repositories',
  {
    projectId: text('project_id').notNull(),
    repoId: text('repo_id').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.repoId] }),
    index('idx_project_repositories_project').on(t.projectId)
  ]
)

// Extra commands the terminal treats as monitored, on top of the built-in
// agent list. Mirrors core-api's ProjectMonitoredCommand, including its
// (project, command) uniqueness.
export const projectMonitoredCommands = sqliteTable(
  'project_monitored_commands',
  {
    projectId: text('project_id').notNull(),
    command: text('command').notNull()
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.command] }),
    index('idx_project_monitored_commands_project').on(t.projectId)
  ]
)

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    name: text('name').notNull(),
    sanitizedName: text('sanitized_name').notNull(),
    branchName: text('branch_name').notNull(),
    sourceBranch: text('source_branch').notNull(),
    createdBy: text('created_by').notNull(),
    ownerName: text('owner_name').notNull(),
    lifecycleStatus: text('lifecycle_status').notNull().default('in_progress'),
    lifecycleStatusChangedAt: integer('lifecycle_status_changed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [index('idx_workspaces_project').on(t.projectId)]
)

export const workspaceRepos = sqliteTable(
  'workspace_repos',
  {
    workspaceId: text('workspace_id').notNull(),
    repoId: text('repo_id').notNull(),
    sourceBranch: text('source_branch')
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.repoId] }),
    index('idx_workspace_repos_workspace').on(t.workspaceId)
  ]
)

// ─── Local Layer ──────────────────────────────────────────────────────────────
// Machine-specific. Never synced to backend. Present in every mode.

export const projectPaths = sqliteTable('project_paths', {
  projectId: text('project_id').primaryKey(),
  localPath: text('local_path').notNull()
})

export const workspaceLocal = sqliteTable('workspace_local', {
  workspaceId: text('workspace_id').primaryKey(),
  // 'open' | 'closed_with_files' | 'closed_clean' | 'broken'
  localStatus: text('local_status').notNull().default('open'),
  // Non-null only when localStatus = 'broken'
  // 'missing_worktree'      — worktree folder deleted outside Braid
  // 'missing_project_path'  — project local path no longer registered
  brokenReason: text('broken_reason'),
  lastOpenedAt: integer('last_opened_at'),
  // 1 = pinned to top of sidebar, 0 = unpinned. Pinned workspaces always appear above unpinned.
  isPinned: integer('is_pinned').notNull().default(0)
})

export const workspaceTerminals = sqliteTable(
  'workspace_terminals',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    terminalId: text('terminal_id').notNull(), // runtime PTY ID — changes on respawn
    label: text('label').notNull(),
    displayOrder: integer('display_order').notNull(),
    isActive: integer('is_active').notNull().default(1), // 0 = terminated, 1 = alive
    panelStatus: text('panel_status').notNull().default('new'), // 'new' | 'resumable'
    createdAt: integer('created_at').notNull()
  },
  (t) => [index('idx_workspace_terminals_workspace').on(t.workspaceId)]
)

export const sessionNames = sqliteTable(
  'session_names',
  {
    sessionId: text('session_id').notNull(),
    agent: text('agent').notNull(),
    name: text('name').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.agent] })]
)

export const scratchPages = sqliteTable('scratch_pages', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  title: text('title').notNull().default(''),
  content: text('content').notNull().default(''), // TipTap JSON (stringified)
  textContent: text('text_content').notNull().default(''), // plain text for search
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull()
})

// ─── Inferred Types ───────────────────────────────────────────────────────────

export type ProjectRow = typeof projects.$inferSelect
export type NewProjectRow = typeof projects.$inferInsert

export type RepositoryRow = typeof repositories.$inferSelect
export type NewRepositoryRow = typeof repositories.$inferInsert

export type WorkspaceRow = typeof workspaces.$inferSelect
export type NewWorkspaceRow = typeof workspaces.$inferInsert

export type WorkspaceRepoRow = typeof workspaceRepos.$inferSelect

export type ProjectPath = typeof projectPaths.$inferSelect

export type WorkspaceLocal = typeof workspaceLocal.$inferSelect

export type WorkspaceTerminal = typeof workspaceTerminals.$inferSelect
export type NewWorkspaceTerminal = typeof workspaceTerminals.$inferInsert

export type SessionName = typeof sessionNames.$inferSelect

export type ScratchPage = typeof scratchPages.$inferSelect
export type NewScratchPage = typeof scratchPages.$inferInsert

// ─── Manually-defined types (formerly inferred from cloud tables) ─────────────
// These match the API response shapes and are used by repository interfaces.

export type Repository = {
  id: string
  name: string
  remoteUrl: string
}
