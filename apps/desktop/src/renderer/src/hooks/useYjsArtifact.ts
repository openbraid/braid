// ─── useYjsArtifact ──────────────────────────────────────────────────────────
// Observes Y.Doc structured data in Shared mode.
// Provides reactive state + generic mutator functions.
//
// Generic mutators work with any array section (requirements, task_list,
// test_cases, security_checks, action_items, etc.) — the StructuredTable component
// uses these instead of per-type mutators.

import { useCallback, useEffect, useState } from 'react'
import * as Y from 'yjs'
import type { ArtifactKind, ArtifactMeta } from '../../../shared/ipc-types'
import { RICH_TEXT_FIELDS } from '../lib/artifact-constants'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Generic structured item — any array item with string fields */
export type StructuredItem = Record<string, unknown> & { id: string }

interface UseYjsArtifactOptions {
  ydoc: Y.Doc | null
}

interface UseYjsArtifactResult {
  meta: ArtifactMeta | null

  /**
   * Read any array section as flat records.
   * Description fields return '' (Collaboration editors render directly).
   */
  readArray: (arrayName: string) => StructuredItem[]

  // ─── Generic mutators (work with any array section) ──────────────

  updateField: (arrayName: string, index: number, field: string, value: string) => void
  addItem: (arrayName: string, item: Record<string, string>) => void
  removeItem: (arrayName: string, index: number) => void

  // ─── Meta ────────────────────────────────────────────────────────

  updateTitle: (title: string) => void
}

// ─── Known array sections to observe ────────────────────────────────────────

const OBSERVED_ARRAYS = [
  'requirements', 'task_list', 'test_cases', 'security_checks',
  'action_items', 'spec_coverage', 'test_coverage', 'change_log',
]

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useYjsArtifact({ ydoc }: UseYjsArtifactOptions): UseYjsArtifactResult {
  const [version, setVersion] = useState(0)
  const rerender = useCallback(() => setVersion((v) => v + 1), [])

  // Observe meta + all known array sections for changes
  useEffect(() => {
    if (!ydoc) return

    const metaMap = ydoc.getMap('meta')
    const metaHandler = () => rerender()
    metaMap.observe(metaHandler)

    const arrayHandlers: Array<{ arr: Y.Array<unknown>; handler: () => void }> = []
    for (const name of OBSERVED_ARRAYS) {
      const arr = ydoc.getArray(name)
      const handler = () => rerender()
      arr.observeDeep(handler)
      arrayHandlers.push({ arr, handler })
    }

    rerender()

    return () => {
      metaMap.unobserve(metaHandler)
      for (const { arr, handler } of arrayHandlers) {
        arr.unobserveDeep(handler)
      }
    }
  }, [ydoc, rerender])

  // ─── Read ──────────────────────────────────────────────────────────────

  const meta = ydoc ? readMeta(ydoc) : null

  const readArray = useCallback(
    (arrayName: string): StructuredItem[] => {
      if (!ydoc) return []
      return readStructuredArray(ydoc, arrayName)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ydoc, version]
  )

  // ─── Generic mutators ──────────────────────────────────────────────────

  const updateField = useCallback(
    (arrayName: string, index: number, field: string, value: string) => {
      if (!ydoc) return
      const arr = ydoc.getArray(arrayName)
      if (index >= arr.length) return
      const itemMap = arr.get(index) as Y.Map<unknown>
      if (!(itemMap instanceof Y.Map)) return

      // Rich-text fields are handled by Collaboration editors
      if (RICH_TEXT_FIELDS.has(field)) return

      const existing = itemMap.get(field)
      if (existing instanceof Y.Text) {
        const oldText = existing.toString()
        if (oldText !== value) {
          ydoc.transact(() => {
            existing.delete(0, existing.length)
            existing.insert(0, value)
          })
        }
      } else {
        itemMap.set(field, value)
      }
    },
    [ydoc]
  )

  const addItem = useCallback(
    (arrayName: string, item: Record<string, string>) => {
      if (!ydoc) return
      const arr = ydoc.getArray(arrayName)

      ydoc.transact(() => {
        const itemMap = new Y.Map()
        for (const [key, value] of Object.entries(item)) {
          if (RICH_TEXT_FIELDS.has(key)) continue // XmlFragment, not Y.Text
          if (key === 'title') {
            // Title is Y.Text for collaborative editing
            const titleText = new Y.Text()
            titleText.insert(0, value ?? '')
            itemMap.set(key, titleText)
          } else {
            itemMap.set(key, value ?? '')
          }
        }
        arr.push([itemMap])
      })
    },
    [ydoc]
  )

  const removeItem = useCallback(
    (arrayName: string, index: number) => {
      if (!ydoc) return
      const arr = ydoc.getArray(arrayName)
      if (index < arr.length) arr.delete(index, 1)
    },
    [ydoc]
  )

  const updateTitle = useCallback(
    (title: string) => {
      if (!ydoc) return
      ydoc.getMap('meta').set('title', title)
    },
    [ydoc]
  )

  return {
    meta,
    readArray,
    updateField,
    addItem,
    removeItem,
    updateTitle,
  }
}

// ─── Read Helpers ─────────────────────────────────────────────────────────────

function readMeta(doc: Y.Doc): ArtifactMeta {
  const metaMap = doc.getMap('meta')
  return {
    kind: (metaMap.get('kind') ?? '') as ArtifactKind,
    title: (metaMap.get('title') as string) ?? '',
  }
}

/**
 * Read a Y.Array as flat structured items.
 * Y.Text fields are read as strings. Description returns '' (rendered by editor).
 */
function readStructuredArray(doc: Y.Doc, arrayName: string): StructuredItem[] {
  const arr = doc.getArray(arrayName)
  const items: StructuredItem[] = []

  arr.forEach((entry) => {
    if (!(entry instanceof Y.Map)) return
    const m = entry as Y.Map<unknown>
    const obj: Record<string, unknown> = {}

    for (const [key, value] of m.entries()) {
      if (RICH_TEXT_FIELDS.has(key)) {
        obj[key] = '' // Rendered by Collaboration editor, not this read
      } else if (value instanceof Y.Text) {
        obj[key] = value.toString()
      } else if (value instanceof Y.Array) {
        obj[key] = value.toArray()
      } else {
        obj[key] = String(value ?? '')
      }
    }

    // Ensure id exists
    if (!obj.id) obj.id = ''

    // Rich-text fields (e.g. description) may be stored as named XmlFragments
    // rather than on the Y.Map itself (reconciliation removes them from the map).
    // Check for their existence so StructuredTable knows rows are expandable.
    for (const field of RICH_TEXT_FIELDS) {
      if (!(field in obj) && obj.id) {
        const frag = doc.getXmlFragment(`${arrayName}:${obj.id}:${field}`)
        if (frag.length > 0) {
          obj[field] = '' // Rendered by Collaboration editor, not this read
        }
      }
    }

    items.push(obj as StructuredItem)
  })

  return items
}
