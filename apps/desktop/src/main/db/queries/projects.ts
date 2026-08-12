// ─── Project queries ─────────────────────────────────────────────────────────
//
// Cloud-layer entities held in SQLite for local mode. Only LocalProjectRepository
// calls these — in team mode the equivalent data comes from core-api.

import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../index'
import { projects, repositories, projectRepositories, projectMonitoredCommands } from '../schema'
import type { ProjectRow, RepositoryRow } from '../schema'
import type { ProjectSettings } from '../../../shared/ipc-types'

export function getAllProjects(): ProjectRow[] {
  return db.select().from(projects).all()
}

export function getProjectById(projectId: string): ProjectRow | undefined {
  return db.select().from(projects).where(eq(projects.id, projectId)).get()
}

export function projectNameExists(name: string): boolean {
  return (
    db.select({ id: projects.id }).from(projects).where(eq(projects.name, name)).get() !== undefined
  )
}

export function insertProject(row: ProjectRow): void {
  db.insert(projects).values(row).run()
}

export function deleteProject(projectId: string): void {
  db.delete(projectRepositories).where(eq(projectRepositories.projectId, projectId)).run()
  db.delete(projects).where(eq(projects.id, projectId)).run()
}

// ─── Repositories ────────────────────────────────────────────────────────────

export function getReposByProject(projectId: string): RepositoryRow[] {
  const links = db
    .select({ repoId: projectRepositories.repoId })
    .from(projectRepositories)
    .where(eq(projectRepositories.projectId, projectId))
    .all()

  if (links.length === 0) return []

  return db
    .select()
    .from(repositories)
    .where(
      inArray(
        repositories.id,
        links.map((l) => l.repoId)
      )
    )
    .all()
}

export function getRepoByRemoteUrl(remoteUrl: string): RepositoryRow | undefined {
  return db.select().from(repositories).where(eq(repositories.remoteUrl, remoteUrl)).get()
}

/**
 * Repositories are identified permanently by remote_url, so a repo shared
 * between two projects is stored once and linked twice. Returns the existing
 * row when the remote is already known.
 */
export function upsertRepository(name: string, remoteUrl: string): RepositoryRow {
  const existing = getRepoByRemoteUrl(remoteUrl)
  if (existing) return existing

  const row: RepositoryRow = {
    id: crypto.randomUUID(),
    name,
    remoteUrl,
    createdAt: Date.now()
  }
  db.insert(repositories).values(row).run()
  return row
}

export function linkRepoToProject(projectId: string, repoId: string): void {
  db.insert(projectRepositories).values({ projectId, repoId }).onConflictDoNothing().run()
}

// ─── Project settings ────────────────────────────────────────────────────────
// Stored as columns on the project row, matching core-api's Project model.
// selectedAgents is a JSON array in both, so the encoding is identical too.

export function getProjectSettings(projectId: string): ProjectSettings | undefined {
  const row = db
    .select({
      artifactsEnabled: projects.artifactsEnabled,
      selectedAgents: projects.selectedAgents
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()

  if (!row) return undefined

  return {
    artifactsEnabled: row.artifactsEnabled === 1,
    selectedAgents: parseAgents(row.selectedAgents)
  }
}

export function updateProjectSettings(
  projectId: string,
  patch: { artifactsEnabled?: boolean; selectedAgents?: string[] }
): void {
  const set: Record<string, unknown> = { updatedAt: Date.now() }
  if (patch.artifactsEnabled !== undefined) set.artifactsEnabled = patch.artifactsEnabled ? 1 : 0
  if (patch.selectedAgents !== undefined) set.selectedAgents = JSON.stringify(patch.selectedAgents)

  db.update(projects).set(set).where(eq(projects.id, projectId)).run()
}

/** A malformed value must not take the app down — treat it as "no agents". */
function parseAgents(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((a): a is string => typeof a === 'string') : []
  } catch {
    console.warn('[queries/projects] selected_agents is not valid JSON — treating as empty')
    return []
  }
}

// ─── Monitored commands ──────────────────────────────────────────────────────

export function getMonitoredCommands(projectId: string): string[] {
  return db
    .select({ command: projectMonitoredCommands.command })
    .from(projectMonitoredCommands)
    .where(eq(projectMonitoredCommands.projectId, projectId))
    .all()
    .map((r) => r.command)
}

export function addMonitoredCommand(projectId: string, command: string): void {
  db.insert(projectMonitoredCommands).values({ projectId, command }).onConflictDoNothing().run()
}

export function removeMonitoredCommand(projectId: string, command: string): void {
  db.delete(projectMonitoredCommands)
    .where(
      and(
        eq(projectMonitoredCommands.projectId, projectId),
        eq(projectMonitoredCommands.command, command)
      )
    )
    .run()
}
