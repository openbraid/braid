// ─── Pending comment highlight ───────────────────────────────────────────────
// Shows a yellow background on the selected text range while the user is
// typing a new comment. Preserves the visual highlight even after the editor
// loses focus to the comment bubble's textarea.

import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pendingCommentHighlight: {
      setPendingCommentRange: (from: number, to: number) => ReturnType
      clearPendingCommentRange: () => ReturnType
    }
  }
}

const pluginKey = new PluginKey('pendingCommentHighlight')

export const PendingCommentHighlight = Extension.create({
  name: 'pendingCommentHighlight',

  addCommands() {
    return {
      setPendingCommentRange: (from: number, to: number) => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setMeta(pluginKey, { from, to })
          dispatch(tr)
        }
        return true
      },
      clearPendingCommentRange: () => ({ tr, dispatch }) => {
        if (dispatch) {
          tr.setMeta(pluginKey, { from: null, to: null })
          dispatch(tr)
        }
        return true
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pluginKey,
        state: {
          init() {
            return DecorationSet.empty
          },
          apply(tr, oldDecos) {
            const meta = tr.getMeta(pluginKey) as { from: number | null; to: number | null } | undefined
            if (meta !== undefined) {
              if (meta.from === null || meta.to === null) return DecorationSet.empty
              const deco = Decoration.inline(meta.from, meta.to, {
                class: 'pending-comment-highlight',
              })
              return DecorationSet.create(tr.doc, [deco])
            }
            if (tr.docChanged) {
              return oldDecos.map(tr.mapping, tr.doc)
            }
            return oldDecos
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
