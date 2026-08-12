import { useMemo, useCallback } from 'react'
import type { Editor } from '@tiptap/core'
import * as Y from 'yjs'
import type { ArtifactKind, ArtifactMeta } from '../../../../shared/ipc-types'
import type { CommentData } from '../../hooks/useComments'
import type { StructuredItem } from '../../hooks/useYjsArtifact'
import type { CommentBubbleProps } from '../comments/CommentBubble'
import { useAuthStore } from '../../store/auth-store'
import { useCommentBubbleStore } from '../../store/comment-bubble-store'
import { ArtifactEditor } from '../artifact-editor/ArtifactEditor'
import { getPositionRelativeToEditor } from '../artifact-editor/editor-utils'
import { StructuredTable } from './StructuredTable'
import { ChangelogView } from './ChangelogView'
import { getPrimarySection } from './constants'
import type { TabId } from './constants'

type SharedModeContentProps = {
  activeTab: TabId
  kind: ArtifactKind
  yjsEditor: Editor | null
  ydoc: Y.Doc | null
  yjsArtifact: {
    meta: ArtifactMeta | null
    readArray: (arrayName: string) => StructuredItem[]
    updateField: (arrayName: string, index: number, field: string, value: string) => void
    addItem: (arrayName: string, item: Record<string, string>) => void
    removeItem: (arrayName: string, index: number) => void
  }
  commentsHook: {
    comments: CommentData[]
    addComment: (from: number, to: number, text: string, fragmentName?: string, commentEditor?: Editor | null) => void
    editComment: (id: string, text: string) => void
    deleteComment: (id: string) => void
    resolveComment: (id: string) => void
    resolveCommentPositions: (fragmentName?: string, resolveEditor?: Editor | null) => Array<{ id: string; pmFrom: number; pmTo: number }>
  }
  /** Array section names present in the YAML (for tab rendering) */
  arraySections: string[]
  onSearchOpen?: () => void
  onLinkInputReady?: (openFn: () => void) => void
}

export function SharedModeContent({
  activeTab,
  kind,
  yjsEditor,
  ydoc,
  yjsArtifact,
  commentsHook,
  arraySections,
  onSearchOpen,
  onLinkInputReady,
}: SharedModeContentProps) {
  const authUser = useAuthStore((s) => s.user)
  const primarySection = getPrimarySection(kind)

  // ─── Comment bubble from store ────────────────────────────────────────
  const bubble = useCommentBubbleStore((s) => s.bubble)
  const openBubble = useCommentBubbleStore((s) => s.openBubble)
  const closeBubble = useCommentBubbleStore((s) => s.closeBubble)

  // Submit comment from bubble
  const handleAddCommentFromBubble = useCallback((text: string) => {
    if (!bubble) return

    const fragment = ('fragmentName' in bubble ? bubble.fragmentName : undefined) ?? 'context'
    const editor = 'sourceEditor' in bubble ? bubble.sourceEditor : undefined

    if (bubble.mode === 'new') {
      commentsHook.addComment(
        bubble.selection.from,
        bubble.selection.to,
        text,
        fragment,
        editor,
      )
    } else if (bubble.mode === 'view') {
      // Resolve positions using the correct fragment + editor for this bubble
      const firstId = bubble.commentIds[0]
      const resolved = commentsHook.resolveCommentPositions(fragment, editor)
      const resolvedFirst = resolved.find((r) => r.id === firstId)
      if (resolvedFirst) {
        commentsHook.addComment(resolvedFirst.pmFrom, resolvedFirst.pmTo, text, fragment, editor)
      }
    }
  }, [bubble, commentsHook])

  // Comments to show in bubble (view mode).
  // Uses position overlap instead of fixed ID list so newly added replies
  // appear immediately without needing to reopen the bubble.
  const bubbleComments: CommentData[] = useMemo(() => {
    if (!bubble || bubble.mode !== 'view') return []

    const fragment = bubble.fragmentName ?? 'context'
    const editor = bubble.sourceEditor
    const resolved = commentsHook.resolveCommentPositions(fragment, editor)

    // Find the range of the first comment to determine the anchor span
    const firstResolved = resolved.find((r) => bubble.commentIds.includes(r.id))
    if (!firstResolved) {
      // Fallback to ID-based filtering if positions can't be resolved
      return commentsHook.comments.filter((c) => bubble.commentIds.includes(c.id))
    }

    // All comments overlapping the same anchor range
    const overlapping = resolved.filter(
      (r) => r.pmFrom <= firstResolved.pmTo && r.pmTo >= firstResolved.pmFrom
    )
    const overlappingIds = new Set(overlapping.map((r) => r.id))
    return commentsHook.comments.filter((c) => overlappingIds.has(c.id))
  }, [bubble, commentsHook])

  // ─── Context editor: select text + click comment icon ─────────────────
  const handleCommentClick = useCallback((selection: { from: number; to: number; text: string }) => {
    if (!yjsEditor) return
    const position = getPositionRelativeToEditor(yjsEditor.view, selection.from)
    if (!position) return

    const resolved = commentsHook.resolveCommentPositions()
    const existingAtRange = resolved.filter(
      (c) => c.pmFrom <= selection.to && c.pmTo >= selection.from
    )

    if (existingAtRange.length > 0) {
      openBubble({ mode: 'view', position, commentIds: existingAtRange.map((c) => c.id) })
    } else {
      openBubble({ mode: 'new', position, selection, fragmentName: 'context' })
    }
  }, [yjsEditor, commentsHook, openBubble])

  // ─── Description comment handler (requirements + tasks) ──────────────
  const handleDescriptionCommentClick = useCallback(
    (selection: { from: number; to: number; text: string }, fragmentName: string, sourceEditor: Editor | null) => {
      if (!sourceEditor) return
      const position = getPositionRelativeToEditor(sourceEditor.view, selection.from)
      if (!position) return

      openBubble({ mode: 'new', position, selection, fragmentName, sourceEditor })
    },
    [openBubble],
  )

  // ─── Shared bubble props (reused for context + requirement) ───────────
  const commentBubbleProps: CommentBubbleProps | null = bubble ? {
    mode: bubble.mode as 'new' | 'view',
    comments: bubble.mode === 'view' ? bubbleComments : [],
    currentUserId: authUser?.id ?? 'anonymous',
    position: { top: bubble.position.top, left: bubble.position.left },
    onAddComment: (text: string) => {
      handleAddCommentFromBubble(text)
      if (bubble.mode === 'new') closeBubble()
    },
    onEditComment: commentsHook.editComment,
    onDeleteComment: commentsHook.deleteComment,
    onResolveComment: commentsHook.resolveComment,
    onClose: closeBubble,
  } : null

  return (
    <>
      {activeTab === 'content' && (
        <>
          <ArtifactEditor
            externalEditor={yjsEditor}
            onCommentClick={handleCommentClick}
            fragmentName="context"
            onSearchOpen={onSearchOpen}
            onLinkInputReady={onLinkInputReady}
            commentBubbleProps={commentBubbleProps}
          />
          {/* Primary work table (lives with context on Content tab) */}
          {primarySection && (
            <StructuredTable
              items={yjsArtifact.readArray(primarySection)}
              arrayName={primarySection}
              ydoc={ydoc}
              onFieldChange={(idx, field, value) => yjsArtifact.updateField(primarySection, idx, field, value)}
              onAdd={(item) => yjsArtifact.addItem(primarySection, item)}
              onRemove={(idx) => yjsArtifact.removeItem(primarySection, idx)}
              onCommentClick={handleDescriptionCommentClick}
              commentBubbleProps={commentBubbleProps}
            />
          )}
        </>
      )}

      {/* Changelog tab */}
      {activeTab === 'changelog' && (
        <ChangelogView entries={yjsArtifact.readArray('change_log')} />
      )}

      {/* Additional array section tabs (analysis, etc.) */}
      {activeTab !== 'content' && activeTab !== 'changelog' && arraySections.includes(activeTab) && (
        <StructuredTable
          items={yjsArtifact.readArray(activeTab)}
          arrayName={activeTab}
          ydoc={ydoc}
          onFieldChange={(idx, field, value) => yjsArtifact.updateField(activeTab, idx, field, value)}
          onAdd={(item) => yjsArtifact.addItem(activeTab, item)}
          onRemove={(idx) => yjsArtifact.removeItem(activeTab, idx)}
        />
      )}
    </>
  )
}
