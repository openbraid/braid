import { eq, sql, and, or, like } from 'drizzle-orm'
import { db } from '../index'
import { scratchPages } from '../schema'
import type { ScratchPage } from '../schema'

export type { ScratchPage }

// ─── Queries ────────────────────────────────────────────────────────────────

export function getPages(userId: string): ScratchPage[] {
  return db
    .select()
    .from(scratchPages)
    .where(eq(scratchPages.userId, userId))
    .orderBy(scratchPages.displayOrder)
    .all()
}

export function getPage(id: string): ScratchPage | undefined {
  return db.select().from(scratchPages).where(eq(scratchPages.id, id)).get()
}

export function createPage(userId: string, title: string): ScratchPage {
  const now = Date.now()
  const nextOrder = getNextDisplayOrder(userId)

  const page: ScratchPage = {
    id: crypto.randomUUID(),
    userId,
    title,
    content: '',
    textContent: '',
    displayOrder: nextOrder,
    createdAt: now,
    updatedAt: now
  }

  db.insert(scratchPages).values(page).run()
  return page
}

export function updatePageContent(id: string, content: string, textContent: string): void {
  db.update(scratchPages)
    .set({ content, textContent, updatedAt: Date.now() })
    .where(eq(scratchPages.id, id))
    .run()
}

export function updatePageTitle(id: string, title: string): void {
  db.update(scratchPages)
    .set({ title, updatedAt: Date.now() })
    .where(eq(scratchPages.id, id))
    .run()
}

export function deletePage(id: string): void {
  db.delete(scratchPages).where(eq(scratchPages.id, id)).run()
}

export function reorderPages(orderedIds: string[]): void {
  for (let i = 0; i < orderedIds.length; i++) {
    db.update(scratchPages)
      .set({ displayOrder: i })
      .where(eq(scratchPages.id, orderedIds[i]))
      .run()
  }
}

export function searchPages(userId: string, query: string): ScratchPage[] {
  const pattern = `%${query}%`
  return db
    .select()
    .from(scratchPages)
    .where(
      and(
        eq(scratchPages.userId, userId),
        or(like(scratchPages.title, pattern), like(scratchPages.textContent, pattern))
      )
    )
    .orderBy(scratchPages.updatedAt)
    .all()
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getNextDisplayOrder(userId: string): number {
  const result = db
    .select({ maxOrder: sql<number>`coalesce(max(${scratchPages.displayOrder}), -1)` })
    .from(scratchPages)
    .where(eq(scratchPages.userId, userId))
    .get()
  return (result?.maxOrder ?? -1) + 1
}
