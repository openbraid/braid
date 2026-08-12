// ─── ArtifactEditor ──────────────────────────────────────────────────────────
// Self-contained Tiptap editor for artifact content.
// All features (toolbar, link, search, pending highlight, comments) work
// automatically in every instance — no external wiring needed per feature.
//
// Comment bubble state lives in Zustand store — any editor instance can
// open the bubble, and the pending highlight reacts to store changes.

import { useCallback, useEffect, useState } from 'react'
import { EditorContent } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { useCommentBubbleStore } from '../../store/comment-bubble-store'
import { useLocalEditor } from './useLocalEditor'
import { BubbleToolbar } from './BubbleToolbar'
import { FloatingLinkInput } from './FloatingLinkInput'
import { TableToolbar } from './TableToolbar'
import { CommentBubble } from '../comments/CommentBubble'
import type { CommentBubbleProps } from '../comments/CommentBubble'
import { getPositionRelativeToEditor } from './editor-utils'
import { EDITOR_CONTAINER_ATTR } from './editor-constants'

export type ArtifactEditorProps = {
  content?: string
  onChange?: (markdown: string) => void
  readOnly?: boolean
  externalEditor?: Editor | null
  onCommentClick?: (selection: { from: number; to: number; text: string }) => void
  fragmentName?: string
  onEditorReady?: (editor: Editor) => void
  onSearchOpen?: () => void
  onLinkInputReady?: (openFn: () => void) => void
  commentBubbleProps?: CommentBubbleProps | null
}

export function ArtifactEditor({
  content,
  onChange,
  readOnly = false,
  externalEditor,
  onCommentClick,
  fragmentName = 'context',
  onEditorReady,
  onSearchOpen,
  onLinkInputReady,
  commentBubbleProps,
}: ArtifactEditorProps) {
  const [linkInput, setLinkInput] = useState<{ top: number; left: number; existingUrl: string } | null>(null)

  const bubble = useCommentBubbleStore((s) => s.bubble)

  const localEditor = useLocalEditor({
    content,
    onChange,
    readOnly,
    skip: !!externalEditor,
  })

  const editor = externalEditor ?? localEditor

  useEffect(() => {
    if (localEditor && !externalEditor && onEditorReady) {
      onEditorReady(localEditor)
    }
  }, [localEditor, externalEditor, onEditorReady])

  // Does the current bubble belong to this editor instance?
  const bubbleFragment = bubble && 'fragmentName' in bubble ? bubble.fragmentName : undefined
  const isMyBubble = bubble !== null &&
    ((!bubbleFragment && fragmentName === 'context') || bubbleFragment === fragmentName)

  // ─── Pending comment highlight (store-driven) ─────────────────────────
  useEffect(() => {
    if (!editor) return
    if (bubble?.mode === 'new' && isMyBubble) {
      editor.commands.setPendingCommentRange(bubble.selection.from, bubble.selection.to)
    } else {
      editor.commands.clearPendingCommentRange()
    }
  }, [editor, bubble, isMyBubble])

  // ─── Link input ───────────────────────────────────────────────────────
  const openLinkInput = useCallback(() => {
    if (!editor) return
    const { from } = editor.state.selection
    const pos = getPositionRelativeToEditor(editor.view, from)
    if (!pos) return
    const existingUrl = (editor.getAttributes('link').href as string) ?? ''
    setLinkInput({ ...pos, existingUrl })
  }, [editor])

  useEffect(() => {
    if (editor && onLinkInputReady) {
      onLinkInputReady(openLinkInput)
    }
  }, [editor, onLinkInputReady, openLinkInput])

  // ─── Keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return
    const el = editor.view.dom

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        onSearchOpen?.()
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        openLinkInput()
      }
    }

    el.addEventListener('keydown', handleKeyDown)
    return () => el.removeEventListener('keydown', handleKeyDown)
  }, [editor, onSearchOpen, openLinkInput])

  // ─── Cmd+Click to open links in browser ───────────────────────────────
  useEffect(() => {
    if (!editor) return
    const el = editor.view.dom
    const handleClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (href) {
        e.preventDefault()
        window.open(href, '_blank')
      }
    }
    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [editor])

  if (!editor) return null

  return (
    <div className="relative" {...{ [EDITOR_CONTAINER_ATTR]: true }}>
      {!readOnly && (
        <BubbleToolbar
          editor={editor}
          onLinkClick={openLinkInput}
          onCommentClick={onCommentClick}
        />
      )}

      <EditorContent editor={editor} />

      {!readOnly && <TableToolbar editor={editor} />}

      {linkInput && (
        <FloatingLinkInput
          editor={editor}
          position={linkInput}
          existingUrl={linkInput.existingUrl}
          onClose={() => setLinkInput(null)}
        />
      )}

      {commentBubbleProps && isMyBubble && (
        <CommentBubble {...commentBubbleProps} />
      )}
    </div>
  )
}
