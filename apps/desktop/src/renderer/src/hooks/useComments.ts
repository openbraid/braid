// ─── useComments ─────────────────────────────────────────────────────────────
// Manages comment state from Y.Doc. Provides CRUD operations, reactive state,
// and position resolution for rendering highlights.
//
// IMPORTANT: Uses y-prosemirror's position mapping functions to convert between
// ProseMirror positions and Yjs relative positions. These are two different
// coordinate systems — ProseMirror counts node boundaries, Yjs doesn't.

import { useCallback, useEffect, useState } from 'react'
import * as Y from 'yjs'
import type { Editor } from '@tiptap/core'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
} from '@tiptap/y-tiptap'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommentData {
  id: string
  author: string
  authorFirstName: string | null
  authorLastName: string | null
  authorPicture: string | null
  text: string
  anchorText: string
  targetType: 'context' | 'requirement' | 'task'
  targetId?: string
  field?: 'title' | 'description'
  startRel: Uint8Array // Y.encodeRelativePosition
  endRel: Uint8Array
  createdAt: number
  editedAt: number | null
  resolved: boolean
  status: 'active' | 'outdated'
}

export interface ResolvedComment extends CommentData {
  pmFrom: number // ProseMirror position
  pmTo: number   // ProseMirror position
}

interface UseCommentsOptions {
  ydoc: Y.Doc | null
  editor: Editor | null // Tiptap editor (for PM ↔ Yjs position mapping)
  userId: string
  userFirstName: string | null
  userLastName: string | null
  userPicture: string | null
  enabled: boolean
}

interface UseCommentsResult {
  comments: CommentData[]
  addComment: (pmFrom: number, pmTo: number, text: string, fragmentName?: string, commentEditor?: Editor | null) => void
  editComment: (commentId: string, newText: string) => void
  deleteComment: (commentId: string) => void
  resolveComment: (commentId: string) => void
  unresolveComment: (commentId: string) => void
  resolveCommentPositions: (fragmentName?: string, resolveEditor?: Editor | null) => ResolvedComment[]
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useComments({ ydoc, editor, userId, userFirstName, userLastName, userPicture, enabled }: UseCommentsOptions): UseCommentsResult {
  const [, setVersion] = useState(0)
  const rerender = useCallback(() => setVersion((v) => v + 1), [])

  // Observe Y.Map('comments') for changes
  useEffect(() => {
    if (!ydoc || !enabled) return

    const commentsMap = ydoc.getMap('comments')
    const handler = () => rerender()
    commentsMap.observeDeep(handler)
    rerender()

    return () => {
      commentsMap.unobserveDeep(handler)
    }
  }, [ydoc, enabled, rerender])

  // ─── Read all comments ────────────────────────────────────────────────

  const comments: CommentData[] = []
  if (ydoc && enabled) {
    const commentsMap = ydoc.getMap('comments')
    for (const [key, value] of commentsMap.entries()) {
      if (key === '_initialized') continue
      if (!(value instanceof Y.Array)) continue

      const arr = value as Y.Array<Y.Map<unknown>>
      for (let i = 0; i < arr.length; i++) {
        const m = arr.get(i)
        if (!(m instanceof Y.Map)) continue
        comments.push(readCommentFromMap(m))
      }
    }
    comments.sort((a, b) => a.createdAt - b.createdAt)
  }

  // ─── Get y-prosemirror binding and mapping ────────────────────────────

  function getBindingFromEditor(ed: Editor) {
    for (const plugin of ed.state.plugins) {
      const key = (plugin as any).key
      if (key && (key === 'y-sync$' || key.startsWith('y-sync'))) {
        const state = plugin.getState(ed.state)
        if (state?.binding) return state.binding
      }
    }
    return null
  }

  // ─── Add Comment ──────────────────────────────────────────────────────
  // Accepts ProseMirror positions. Uses y-prosemirror to convert to Yjs
  // relative positions that correctly target the right Y.XmlText node.

  /**
   * Add a comment anchored to a specific fragment.
   * @param pmFrom - ProseMirror start position
   * @param pmTo - ProseMirror end position
   * @param text - Comment text
   * @param fragmentName - Y.XmlFragment name (default: 'context')
   * @param commentEditor - Editor instance for this fragment (default: main editor)
   */
  const addComment = useCallback(
    (pmFrom: number, pmTo: number, text: string, fragmentName = 'context', commentEditor?: Editor | null) => {
      if (!ydoc) return
      const editorToUse = commentEditor ?? editor
      if (!editorToUse) return

      const binding = getBindingFromEditor(editorToUse)
      if (!binding) {
        console.error('[useComments] addComment: y-sync binding not found in editor plugins')
        return
      }

      const yXmlFragment = ydoc.getXmlFragment(fragmentName)
      const anchorText = editorToUse.state.doc.textBetween(pmFrom, pmTo)

      const startRel = absolutePositionToRelativePosition(pmFrom, yXmlFragment, binding.mapping)
      const endRel = absolutePositionToRelativePosition(pmTo, yXmlFragment, binding.mapping)

      const commentsMap = ydoc.getMap('comments')

      ydoc.transact(() => {
        let arr = commentsMap.get(fragmentName) as Y.Array<Y.Map<unknown>> | undefined
        if (!arr || !(arr instanceof Y.Array)) {
          arr = new Y.Array<Y.Map<unknown>>()
          commentsMap.set(fragmentName, arr)
        }

        const commentMap = new Y.Map<unknown>()
        const id = `cmt-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`

        commentMap.set('id', id)
        commentMap.set('author', userId)
        commentMap.set('authorFirstName', userFirstName)
        commentMap.set('authorLastName', userLastName)
        commentMap.set('authorPicture', userPicture)
        commentMap.set('text', text)
        commentMap.set('anchorText', anchorText)
        commentMap.set('targetType', fragmentName === 'context' ? 'context' : 'requirement')
        commentMap.set('startRel', Y.encodeRelativePosition(startRel))
        commentMap.set('endRel', Y.encodeRelativePosition(endRel))
        commentMap.set('createdAt', Date.now())
        commentMap.set('editedAt', null)
        commentMap.set('resolved', false)
        commentMap.set('status', 'active')

        arr.push([commentMap])
      })
    },
    [ydoc, editor, userId]
  )

  // ─── Edit Comment ─────────────────────────────────────────────────────

  const editComment = useCallback(
    (commentId: string, newText: string) => {
      if (!ydoc) return
      const m = findCommentMap(ydoc, commentId)
      if (!m) return
      if (m.get('author') !== userId) return

      ydoc.transact(() => {
        m.set('text', newText)
        m.set('editedAt', Date.now())
      })
    },
    [ydoc, userId]
  )

  // ─── Delete Comment ───────────────────────────────────────────────────

  const deleteComment = useCallback(
    (commentId: string) => {
      if (!ydoc) return
      const commentsMap = ydoc.getMap('comments')

      ydoc.transact(() => {
        for (const [key, value] of commentsMap.entries()) {
          if (!(value instanceof Y.Array)) continue
          const arr = value as Y.Array<Y.Map<unknown>>

          for (let i = 0; i < arr.length; i++) {
            const m = arr.get(i)
            if (m instanceof Y.Map && m.get('id') === commentId) {
              if (m.get('author') !== userId) return
              arr.delete(i, 1)
              if (arr.length === 0) commentsMap.delete(key)
              return
            }
          }
        }
      })
    },
    [ydoc, userId]
  )

  // ─── Resolve / Unresolve ──────────────────────────────────────────────

  const resolveComment = useCallback(
    (commentId: string) => {
      if (!ydoc) return
      const m = findCommentMap(ydoc, commentId)
      if (m) m.set('resolved', true)
    },
    [ydoc]
  )

  const unresolveComment = useCallback(
    (commentId: string) => {
      if (!ydoc) return
      const m = findCommentMap(ydoc, commentId)
      if (m) m.set('resolved', false)
    },
    [ydoc]
  )

  // ─── Resolve Comment Positions (returns ProseMirror positions) ────────
  // Uses y-prosemirror to convert Yjs relative positions → PM positions
  // for rendering decorations at the correct location.

  /**
   * Resolve comment positions to ProseMirror coordinates.
   * When called without params, resolves context comments using the main editor.
   * When called with fragmentName + editor, resolves that fragment's comments.
   */
  const resolveCommentPositions = useCallback(
    (fragmentName = 'context', resolveEditor?: Editor | null): ResolvedComment[] => {
      if (!ydoc) return []
      const ed = resolveEditor ?? editor
      if (!ed) return []

      const binding = getBindingFromEditor(ed)
      if (!binding) return []

      const yXmlFragment = ydoc.getXmlFragment(fragmentName)

      return comments
        .filter((c) => c.status === 'active' && c.startRel && c.endRel)
        .map((c) => {
          const startRel = Y.decodeRelativePosition(c.startRel)
          const endRel = Y.decodeRelativePosition(c.endRel)

          const pmFrom = relativePositionToAbsolutePosition(ydoc, yXmlFragment, startRel, binding.mapping)
          const pmTo = relativePositionToAbsolutePosition(ydoc, yXmlFragment, endRel, binding.mapping)

          if (pmFrom === null || pmTo === null) return null

          return { ...c, pmFrom, pmTo }
        })
        .filter((c): c is ResolvedComment => c !== null)
    },
    [ydoc, editor, comments]
  )

  return {
    comments,
    addComment,
    editComment,
    deleteComment,
    resolveComment,
    unresolveComment,
    resolveCommentPositions,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readCommentFromMap(m: Y.Map<unknown>): CommentData {
  return {
    id: String(m.get('id') ?? ''),
    author: String(m.get('author') ?? ''),
    authorFirstName: (m.get('authorFirstName') as string) ?? null,
    authorLastName: (m.get('authorLastName') as string) ?? null,
    authorPicture: (m.get('authorPicture') as string) ?? null,
    text: String(m.get('text') ?? ''),
    anchorText: String(m.get('anchorText') ?? ''),
    targetType: (m.get('targetType') as CommentData['targetType']) ?? 'context',
    targetId: m.get('targetId') as string | undefined,
    field: m.get('field') as CommentData['field'],
    startRel: m.get('startRel') as Uint8Array,
    endRel: m.get('endRel') as Uint8Array,
    createdAt: (m.get('createdAt') as number) ?? 0,
    editedAt: (m.get('editedAt') as number) ?? null,
    resolved: (m.get('resolved') as boolean) ?? false,
    status: (m.get('status') as CommentData['status']) ?? 'active',
  }
}

function findCommentMap(doc: Y.Doc, commentId: string): Y.Map<unknown> | null {
  const commentsMap = doc.getMap('comments')

  for (const [, value] of commentsMap.entries()) {
    if (!(value instanceof Y.Array)) continue
    const arr = value as Y.Array<Y.Map<unknown>>

    for (let i = 0; i < arr.length; i++) {
      const m = arr.get(i)
      if (m instanceof Y.Map && m.get('id') === commentId) {
        return m
      }
    }
  }

  return null
}
