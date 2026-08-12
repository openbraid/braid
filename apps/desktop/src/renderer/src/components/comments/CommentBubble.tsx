// ─── CommentBubble ───────────────────────────────────────────────────────────
// Thread-style floating bubble anchored near highlighted text.
//
// Two modes:
//   "new"  — Minimal input area with placeholder. No chrome.
//   "view" — Shows existing comment thread + reply input at bottom.

import { useState, useRef, useEffect, useCallback } from 'react'
import { Check, Pencil, Trash2 } from 'lucide-react'
import type { CommentData } from '../../hooks/useComments'
import { relativeTime, getCommentDisplayName, getCommentInitials } from '../artifact-editor/editor-utils'
import { FOCUS_DELAY_MS, TEXTAREA_MAX_LINES, TEXTAREA_LINE_HEIGHT_PX, TEXTAREA_PADDING_PX } from '../artifact-editor/editor-constants'

type CommentBubbleMode = 'new' | 'view'

export interface CommentBubbleProps {
  mode: CommentBubbleMode
  comments: CommentData[]
  currentUserId: string
  position: { top: number; left: number }
  onAddComment: (text: string) => void
  onEditComment: (id: string, text: string) => void
  onDeleteComment: (id: string) => void
  onResolveComment: (id: string) => void
  onClose: () => void
}

// Neutral avatar colors (Notion/Linear style)
const AVATAR_COLORS = [
  { bg: '#e8e8e8', fg: '#6b6b6b' },
  { bg: '#dbeafe', fg: '#3b82f6' },
  { bg: '#dcfce7', fg: '#22c55e' },
  { bg: '#fef3c7', fg: '#d97706' },
  { bg: '#ede9fe', fg: '#8b5cf6' },
  { bg: '#fce7f3', fg: '#ec4899' },
  { bg: '#e0f2fe', fg: '#0ea5e9' },
  { bg: '#f1f5f9', fg: '#64748b' },
]

function getAvatarColor(name: string) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}


export function CommentBubble({
  mode,
  comments,
  currentUserId,
  position,
  onAddComment,
  onEditComment,
  onDeleteComment,
  onResolveComment,
  onClose,
}: CommentBubbleProps) {
  const [replyText, setReplyText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const replyRef = useRef<HTMLTextAreaElement>(null)
  const editRef = useRef<HTMLTextAreaElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const threadScrollRef = useRef<HTMLDivElement>(null)

  const [adjustedLeft, setAdjustedLeft] = useState<number | null>(null)

  useEffect(() => {
    setTimeout(() => replyRef.current?.focus(), FOCUS_DELAY_MS)
  }, [])

  // Clamp horizontal position so the bubble stays within its parent container.
  // Runs after render when the bubble's actual width is known — no hardcoded sizes.
  useEffect(() => {
    const el = bubbleRef.current
    if (!el) return
    const parent = el.offsetParent as HTMLElement | null
    if (!parent) return

    const bubbleWidth = el.offsetWidth
    const parentWidth = parent.offsetWidth
    const maxLeft = parentWidth - bubbleWidth
    if (position.left > maxLeft) {
      setAdjustedLeft(Math.max(0, maxLeft))
    } else {
      setAdjustedLeft(null)
    }
  }, [position.left])

  // Scroll thread to bottom on mount and when comments change
  useEffect(() => {
    if (threadScrollRef.current) {
      threadScrollRef.current.scrollTop = threadScrollRef.current.scrollHeight
    }
  }, [comments.length])

  useEffect(() => {
    if (editingId && editRef.current) editRef.current.focus()
  }, [editingId])

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (bubbleRef.current && !bubbleRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const handleSubmitReply = () => {
    const trimmed = replyText.trim()
    if (!trimmed) return
    onAddComment(trimmed)
    setReplyText('')
    if (mode === 'new') onClose()
  }

  const handleReplyKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmitReply()
    }
    if (e.key === 'Escape') onClose()
  }

  const handleEditSubmit = (id: string) => {
    const trimmed = editText.trim()
    if (!trimmed) return
    onEditComment(id, trimmed)
    setEditingId(null)
  }

  const handleEditKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleEditSubmit(id)
    }
    if (e.key === 'Escape') setEditingId(null)
  }

  // Auto-resize textarea (max 4 lines)
  const autoResize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return
    el.style.height = 'auto'
    const maxHeight = TEXTAREA_LINE_HEIGHT_PX * TEXTAREA_MAX_LINES + TEXTAREA_PADDING_PX
    el.style.height = Math.min(el.scrollHeight, maxHeight) + 'px'
  }, [])

  // ─── New comment mode: minimal ─────────────────────────────────────────
  if (mode === 'new') {
    return (
      <div
        ref={bubbleRef}
        className="absolute z-50 w-72 bg-surface-elevated border border-border rounded-lg shadow-lg overflow-hidden"
        style={{ top: position.top, left: adjustedLeft ?? Math.max(0, position.left) }}
      >
        <textarea
          ref={(el) => { (replyRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el; autoResize(el) }}
          value={replyText}
          onChange={(e) => { setReplyText(e.target.value); autoResize(e.target) }}
          onKeyDown={handleReplyKeyDown}
          placeholder="Add a comment..."
          className="w-full text-[12px] bg-transparent px-3 py-2.5 text-fg placeholder:text-fg-tertiary resize-none outline-none leading-[18px]"
          rows={1}
        />
        {replyText.trim() && (
          <div className="flex justify-end px-3 pb-2">
            <button
              onClick={handleSubmitReply}
              className="text-[11px] font-medium text-fg-inverse bg-fg px-2.5 py-1 rounded hover:opacity-90 transition-opacity"
            >
              Comment
            </button>
          </div>
        )}
      </div>
    )
  }

  // ─── View mode: thread ─────────────────────────────────────────────────
  return (
    <div
      ref={bubbleRef}
      className="absolute z-50 w-80 bg-surface-elevated border border-border rounded-lg shadow-lg overflow-hidden"
      style={{ top: position.top, left: adjustedLeft ?? Math.max(0, position.left) }}
    >
      {/* Comments thread */}
      {comments.length > 0 && (
        <div ref={threadScrollRef} className="max-h-72 overflow-y-auto">
          {comments.map((comment, idx) => {
            const isOwn = comment.author === currentUserId
            const isHovered = hoveredId === comment.id
            const isEditing = editingId === comment.id
            const isLast = idx === comments.length - 1
            const displayName = getCommentDisplayName(comment)
            const initials = getCommentInitials(comment)
            const avatar = getAvatarColor(displayName)

            return (
              <div
                key={comment.id}
                className={`px-3 py-2.5 transition-colors ${!isLast ? 'border-b border-border-subtle' : ''}`}
                onMouseEnter={() => setHoveredId(comment.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                {/* Author row */}
                <div className="flex items-center gap-2 mb-1">
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-semibold shrink-0"
                    style={{ background: avatar.bg, color: avatar.fg }}
                  >
                    {initials}
                  </div>
                  <span className="text-[12px] font-medium text-fg flex-1 truncate">
                    {isOwn ? 'You' : displayName}
                  </span>
                  <span className="text-[10px] text-fg-tertiary shrink-0">
                    {relativeTime(comment.createdAt)}
                    {comment.editedAt ? ' (edited)' : ''}
                  </span>

                  {/* Actions on hover (own comments only) */}
                  {isOwn && isHovered && !isEditing && (
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => onResolveComment(comment.id)}
                        className={`p-0.5 rounded transition-colors ${
                          comment.resolved
                            ? 'text-green-500 hover:text-green-600'
                            : 'text-fg-tertiary hover:text-green-500'
                        }`}
                        title={comment.resolved ? 'Unresolve' : 'Resolve'}
                      >
                        <Check size={11} />
                      </button>
                      <button
                        onClick={() => { setEditingId(comment.id); setEditText(comment.text) }}
                        className="p-0.5 text-fg-tertiary hover:text-fg rounded transition-colors"
                        title="Edit"
                      >
                        <Pencil size={11} />
                      </button>
                      <button
                        onClick={() => onDeleteComment(comment.id)}
                        className="p-0.5 text-fg-tertiary hover:text-red-500 rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  )}

                  {/* Resolved badge (visible when not hovered) */}
                  {comment.resolved && !(isOwn && isHovered) && (
                    <Check size={11} className="text-green-500 shrink-0" />
                  )}
                </div>

                {/* Comment text or edit mode */}
                {isEditing ? (
                  <div className="ml-7">
                    <textarea
                      ref={editRef}
                      value={editText}
                      onChange={(e) => { setEditText(e.target.value); autoResize(e.target) }}
                      onKeyDown={(e) => handleEditKeyDown(e, comment.id)}
                      className="w-full text-[12px] bg-surface border border-border rounded-md px-2 py-1.5 text-fg resize-none outline-none focus:border-fg-tertiary leading-[18px]"
                      rows={2}
                    />
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        onClick={() => handleEditSubmit(comment.id)}
                        className="text-[10px] font-medium text-fg hover:opacity-70 transition-opacity"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-[10px] text-fg-tertiary hover:text-fg-secondary transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="text-[12px] text-fg leading-relaxed ml-7 whitespace-pre-wrap">
                    {comment.text}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Reply input — divider on top, minimal */}
      <div className="border-t border-border-subtle px-3 py-2.5">
        <textarea
          ref={(el) => { (replyRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el; autoResize(el) }}
          value={replyText}
          onChange={(e) => { setReplyText(e.target.value); autoResize(e.target) }}
          onKeyDown={handleReplyKeyDown}
          placeholder="Reply..."
          className="w-full text-[12px] bg-transparent text-fg placeholder:text-fg-tertiary resize-none outline-none leading-[18px]"
          rows={1}
        />
        {replyText.trim() && (
          <div className="flex justify-end mt-1">
            <button
              onClick={handleSubmitReply}
              className="text-[11px] font-medium text-fg-inverse bg-fg px-2.5 py-1 rounded hover:opacity-90 transition-opacity"
            >
              Reply
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

