// ─── Search & highlight extension ────────────────────────────────────────────
// Lightweight per-editor search: stores query in plugin state, highlights all
// matches as ProseMirror decorations, tracks an active match index for
// next/prev navigation. No external dependencies.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { Node as PmNode } from '@tiptap/pm/model'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

// Extend Tiptap's command interface so editor.commands.setSearchQuery etc. are typed
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    searchHighlight: {
      setSearchQuery: (query: string) => ReturnType
      nextSearchMatch: () => ReturnType
      prevSearchMatch: () => ReturnType
      clearSearch: () => ReturnType
    }
  }
}

export interface SearchStorage {
  query: string
  matchCount: number
  activeIndex: number
}

const searchPluginKey = new PluginKey('searchHighlight')

function findMatches(doc: PmNode, query: string): Array<{ from: number; to: number }> {
  if (!query) return []

  const lower = query.toLowerCase()
  const results: Array<{ from: number; to: number }> = []

  // Walk every text node in the document. Each text node knows its exact
  // PM position via the `pos` callback argument from descendants().
  // This avoids the textBetween position drift caused by block boundaries.
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return

    const text = node.text.toLowerCase()
    let start = 0
    while (true) {
      const idx = text.indexOf(lower, start)
      if (idx === -1) break
      results.push({ from: pos + idx, to: pos + idx + query.length })
      start = idx + 1
    }
  })

  return results
}

function buildDecorations(
  doc: PmNode,
  query: string,
  activeIndex: number
): { decorations: DecorationSet; matches: Array<{ from: number; to: number }> } {
  const matches = findMatches(doc, query)
  if (matches.length === 0) {
    return { decorations: DecorationSet.empty, matches }
  }

  const decos = matches.map((m, i) =>
    Decoration.inline(m.from, m.to, {
      class: i === activeIndex ? 'search-match-active' : 'search-match',
    })
  )

  return { decorations: DecorationSet.create(doc, decos), matches }
}

export const SearchHighlight = Extension.create<Record<string, never>, SearchStorage>({
  name: 'searchHighlight',

  addStorage() {
    return {
      query: '',
      matchCount: 0,
      activeIndex: 0,
    }
  },

  addCommands() {
    return {
      setSearchQuery: (query: string) => ({ editor, tr, dispatch }) => {
        if (dispatch) {
          this.storage.query = query
          this.storage.activeIndex = 0
          tr.setMeta(searchPluginKey, { query, activeIndex: 0 })
          dispatch(tr)

          const { matches } = buildDecorations(editor.state.doc, query, 0)
          this.storage.matchCount = matches.length
        }
        return true
      },

      nextSearchMatch: () => ({ editor, tr, dispatch }) => {
        if (dispatch) {
          const count = this.storage.matchCount
          if (count === 0) return true
          const next = (this.storage.activeIndex + 1) % count
          this.storage.activeIndex = next
          tr.setMeta(searchPluginKey, { query: this.storage.query, activeIndex: next })
          dispatch(tr)

          const matches = findMatches(editor.state.doc, this.storage.query)
          if (matches[next]) {
            editor.commands.setTextSelection(matches[next].from)
            const domAtPos = editor.view.domAtPos(matches[next].from)
            const node = domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement
            node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }
        return true
      },

      prevSearchMatch: () => ({ editor, tr, dispatch }) => {
        if (dispatch) {
          const count = this.storage.matchCount
          if (count === 0) return true
          const prev = (this.storage.activeIndex - 1 + count) % count
          this.storage.activeIndex = prev
          tr.setMeta(searchPluginKey, { query: this.storage.query, activeIndex: prev })
          dispatch(tr)

          const matches = findMatches(editor.state.doc, this.storage.query)
          if (matches[prev]) {
            editor.commands.setTextSelection(matches[prev].from)
            const domAtPos = editor.view.domAtPos(matches[prev].from)
            const node = domAtPos.node instanceof HTMLElement ? domAtPos.node : domAtPos.node.parentElement
            node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }
        return true
      },

      clearSearch: () => ({ tr, dispatch }) => {
        if (dispatch) {
          this.storage.query = ''
          this.storage.matchCount = 0
          this.storage.activeIndex = 0
          tr.setMeta(searchPluginKey, { query: '', activeIndex: 0 })
          dispatch(tr)
        }
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    const storage = this.storage

    return [
      new Plugin({
        key: searchPluginKey,

        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, oldDecos) {
            const meta = tr.getMeta(searchPluginKey) as { query: string; activeIndex: number } | undefined
            if (meta !== undefined) {
              const { decorations, matches } = buildDecorations(tr.doc, meta.query, meta.activeIndex)
              storage.matchCount = matches.length
              return decorations
            }
            if (tr.docChanged && storage.query) {
              const { decorations, matches } = buildDecorations(tr.doc, storage.query, storage.activeIndex)
              storage.matchCount = matches.length
              return decorations
            }
            return oldDecos.map(tr.mapping, tr.doc)
          },
        },

        props: {
          decorations(state) {
            return this.getState(state)
          },
        },
      }),
    ]
  },
})
