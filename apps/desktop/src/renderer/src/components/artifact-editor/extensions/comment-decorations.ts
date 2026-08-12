// ─── Comment Decorations Plugin ───────────────────────────────────────────────
// ProseMirror plugin that renders yellow underline decorations for comments
// and handles click-on-highlight → open comment bubble via Zustand store.
//
// Resolves Yjs relative positions to PM positions on every state update.
// Click handler writes directly to the comment bubble store — no callbacks needed.

import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import type { Editor } from '@tiptap/core'
import * as Y from 'yjs'
import { relativePositionToAbsolutePosition } from '@tiptap/y-tiptap'
import type { Node as PmNode } from '@tiptap/pm/model'

/** y-prosemirror binding mapping — not re-exported from @tiptap/y-tiptap */
type ProsemirrorMapping = Map<Y.AbstractType<any>, PmNode | PmNode[]>
import { useCommentBubbleStore } from '../../../store/comment-bubble-store'
import { getPositionRelativeToEditor } from '../editor-utils'

export interface CommentPluginOptions {
  ydoc: Y.Doc
  fragmentName?: string
  editorRef?: { current: Editor | null }
}

interface ResolvedComment {
  id: string
  pmFrom: number
  pmTo: number
}

const commentDecorationKey = new PluginKey('commentDecorations')

// ─── Shared helpers ──────────────────────────────────────────────────────────

function getYSyncBinding(state: EditorState): { mapping: ProsemirrorMapping } | null {
  for (const plugin of state.plugins) {
    const key = (plugin as unknown as { key: string }).key
    if (key && (key === 'y-sync$' || key.startsWith('y-sync'))) {
      const pluginState = plugin.getState(state) as { binding?: { mapping: ProsemirrorMapping } } | undefined
      if (pluginState?.binding) return pluginState.binding
    }
  }
  return null
}

function resolveAllComments(
  ydoc: Y.Doc,
  mapping: ProsemirrorMapping,
  fragmentName: string,
): ResolvedComment[] {
  const commentsMap = ydoc.getMap('comments')
  const yXmlFragment = ydoc.getXmlFragment(fragmentName)
  const results: ResolvedComment[] = []

  for (const [key, value] of commentsMap.entries()) {
    if (key === '_initialized') continue
    if (!(value instanceof Y.Array)) continue

    const arr = value as Y.Array<Y.Map<unknown>>
    for (let i = 0; i < arr.length; i++) {
      const m = arr.get(i)
      if (!(m instanceof Y.Map)) continue

      const status = m.get('status') as string | undefined
      if (status === 'outdated') continue

      const startRelBytes = m.get('startRel') as Uint8Array | undefined
      const endRelBytes = m.get('endRel') as Uint8Array | undefined
      if (!startRelBytes || !endRelBytes) continue

      const startRel = Y.decodeRelativePosition(startRelBytes)
      const endRel = Y.decodeRelativePosition(endRelBytes)

      const pmFrom = relativePositionToAbsolutePosition(ydoc, yXmlFragment, startRel, mapping)
      const pmTo = relativePositionToAbsolutePosition(ydoc, yXmlFragment, endRel, mapping)

      if (pmFrom === null || pmTo === null) continue

      const id = (m.get('id') as string) ?? ''
      if (id) results.push({ id, pmFrom, pmTo })
    }
  }

  return results
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

export function createCommentDecorationsPlugin(options: CommentPluginOptions): Plugin {
  const { ydoc, fragmentName = 'context', editorRef } = options

  return new Plugin({
    key: commentDecorationKey,

    props: {
      decorations(state) {
        const binding = getYSyncBinding(state)
        if (!binding) return DecorationSet.empty

        try {
          const comments = resolveAllComments(ydoc, binding.mapping, fragmentName)

          const decorations = comments
            .filter((c) => c.pmFrom < c.pmTo && c.pmFrom >= 0 && c.pmTo <= state.doc.content.size)
            .map((c) =>
              Decoration.inline(c.pmFrom, c.pmTo, {
                class: 'comment-highlight',
                'data-comment-ids': c.id,
              })
            )

          return DecorationSet.create(state.doc, decorations)
        } catch {
          return DecorationSet.empty
        }
      },

      handleClick(view: EditorView, pos: number, event: MouseEvent) {
        const target = event.target as HTMLElement
        if (!target.closest?.('.comment-highlight')) return false

        const binding = getYSyncBinding(view.state)
        if (!binding) return false

        try {
          const comments = resolveAllComments(ydoc, binding.mapping, fragmentName)
          const commentIds = comments
            .filter((c) => pos >= c.pmFrom && pos <= c.pmTo)
            .map((c) => c.id)

          if (commentIds.length === 0) return false

          const position = getPositionRelativeToEditor(view, pos)
          if (!position) return false

          useCommentBubbleStore.getState().openBubble({
            mode: 'view',
            position,
            commentIds,
            fragmentName,
            sourceEditor: editorRef?.current ?? null,
          })

          return true
        } catch {
          return false
        }
      },
    },
  })
}
