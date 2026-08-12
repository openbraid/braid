// ─── CommentHighlight ────────────────────────────────────────────────────────
// Renders text with yellow highlight spans for comments on requirements/tasks.
// These are React components (not Tiptap), so comments need manual rendering.
// Supports text selection for adding new comments.

import { useRef, useCallback } from 'react'

/** Comment with character offsets for plain-text highlighting (not ProseMirror positions) */
interface TextComment {
  id: string
  startOffset: number
  endOffset: number
}

interface CommentHighlightProps {
  text: string
  resolvedComments: TextComment[]
  onSelectText?: (startOffset: number, endOffset: number, selectedText: string) => void
  onClickHighlight?: (commentIds: string[], position: { top: number; left: number }) => void
}

export function CommentHighlight({
  text,
  resolvedComments,
  onSelectText,
  onClickHighlight,
}: CommentHighlightProps) {
  const containerRef = useRef<HTMLSpanElement>(null)

  // Build segments: split text into highlighted and non-highlighted parts
  const segments = buildSegments(text, resolvedComments)

  const handleMouseUp = useCallback(() => {
    if (!onSelectText) return
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed) return

    const container = containerRef.current
    if (!container) return

    // Check selection is within our container
    if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) return

    const selectedText = selection.toString()
    if (!selectedText.trim()) return

    // Calculate offset within the text
    const range = selection.getRangeAt(0)
    const preRange = document.createRange()
    preRange.selectNodeContents(container)
    preRange.setEnd(range.startContainer, range.startOffset)
    const startOffset = preRange.toString().length
    const endOffset = startOffset + selectedText.length

    onSelectText(startOffset, endOffset, selectedText)
  }, [onSelectText])

  const handleHighlightClick = useCallback(
    (commentIds: string[], e: React.MouseEvent) => {
      if (!onClickHighlight) return
      e.stopPropagation()
      onClickHighlight(commentIds, {
        top: e.clientY + 8,
        left: e.clientX,
      })
    },
    [onClickHighlight]
  )

  return (
    <span ref={containerRef} onMouseUp={handleMouseUp}>
      {segments.map((segment, i) => {
        if (segment.commentIds.length > 0) {
          return (
            <span
              key={i}
              className="comment-highlight cursor-pointer"
              onClick={(e) => handleHighlightClick(segment.commentIds, e)}
            >
              {segment.text}
            </span>
          )
        }
        return <span key={i}>{segment.text}</span>
      })}
    </span>
  )
}

// ─── Segment Builder ──────────────────────────────────────────────────────────

interface TextSegment {
  text: string
  commentIds: string[]
}

function buildSegments(text: string, comments: TextComment[]): TextSegment[] {
  if (comments.length === 0) {
    return [{ text, commentIds: [] }]
  }

  // Build a character-level comment map
  const charComments: string[][] = new Array(text.length).fill(null).map(() => [])

  for (const comment of comments) {
    if (comment.startOffset < 0 || comment.endOffset < 0) continue
    const start = Math.max(0, comment.startOffset)
    const end = Math.min(text.length, comment.endOffset)

    for (let i = start; i < end; i++) {
      charComments[i].push(comment.id)
    }
  }

  // Merge consecutive characters with same comment set into segments
  const segments: TextSegment[] = []
  let currentIds: string[] = []
  let currentStart = 0

  for (let i = 0; i <= text.length; i++) {
    const ids = i < text.length ? charComments[i] : []
    const sameIds =
      ids.length === currentIds.length &&
      ids.every((id, idx) => currentIds[idx] === id)

    if (!sameIds || i === text.length) {
      if (i > currentStart) {
        segments.push({
          text: text.substring(currentStart, i),
          commentIds: [...currentIds],
        })
      }
      currentIds = ids
      currentStart = i
    }
  }

  return segments
}
