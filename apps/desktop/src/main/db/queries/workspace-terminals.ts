import { eq, sql } from 'drizzle-orm'
import { db } from '../index'
import { workspaceTerminals } from '../schema'
import type { WorkspaceTerminal } from '../schema'

export type { WorkspaceTerminal }

export function createTerminalRecord(data: {
  workspaceId: string
  terminalId: string
  label: string
}): WorkspaceTerminal {
  const now = Date.now()
  const nextOrder = getNextDisplayOrder(data.workspaceId)

  const record: WorkspaceTerminal = {
    id: crypto.randomUUID(),
    workspaceId: data.workspaceId,
    terminalId: data.terminalId,
    label: data.label,
    displayOrder: nextOrder,
    isActive: 1,
    panelStatus: 'new',
    createdAt: now
  }

  db.insert(workspaceTerminals).values(record).run()
  return record
}

export function getTerminalsByWorkspace(workspaceId: string): WorkspaceTerminal[] {
  return db
    .select()
    .from(workspaceTerminals)
    .where(eq(workspaceTerminals.workspaceId, workspaceId))
    .orderBy(workspaceTerminals.displayOrder)
    .all()
}

export function getActiveTerminalsByWorkspace(workspaceId: string): WorkspaceTerminal[] {
  return db
    .select()
    .from(workspaceTerminals)
    .where(sql`${workspaceTerminals.workspaceId} = ${workspaceId} AND ${workspaceTerminals.isActive} = 1`)
    .orderBy(workspaceTerminals.displayOrder)
    .all()
}

export function getTerminalById(id: string): WorkspaceTerminal | undefined {
  return db.select().from(workspaceTerminals).where(eq(workspaceTerminals.id, id)).get()
}

export function updateTerminalLabel(id: string, label: string): void {
  db.update(workspaceTerminals).set({ label }).where(eq(workspaceTerminals.id, id)).run()
}

export function updateTerminalPtyId(id: string, terminalId: string): void {
  db.update(workspaceTerminals)
    .set({ terminalId })
    .where(eq(workspaceTerminals.id, id))
    .run()
}

export function deactivateTerminal(id: string): void {
  db.update(workspaceTerminals)
    .set({ isActive: 0 })
    .where(eq(workspaceTerminals.id, id))
    .run()
}

export function updatePanelStatus(id: string, panelStatus: 'new' | 'resumable'): void {
  db.update(workspaceTerminals)
    .set({ panelStatus })
    .where(eq(workspaceTerminals.id, id))
    .run()
}

export function deleteTerminalRecord(id: string): void {
  db.delete(workspaceTerminals).where(eq(workspaceTerminals.id, id)).run()
}

export function deleteTerminalsByWorkspace(workspaceId: string): void {
  db.delete(workspaceTerminals).where(eq(workspaceTerminals.workspaceId, workspaceId)).run()
}

function getNextDisplayOrder(workspaceId: string): number {
  const result = db
    .select({ maxOrder: sql<number>`coalesce(max(${workspaceTerminals.displayOrder}), -1)` })
    .from(workspaceTerminals)
    .where(eq(workspaceTerminals.workspaceId, workspaceId))
    .get()
  return (result?.maxOrder ?? -1) + 1
}
