// ─── CommentPanel ────────────────────────────────────────────────────────────
// Right-side panel showing all comments as a history feed.
// Independent scroll from the document. Filter by All / Open / Resolved.
// Auto-scrolls to bottom on mount and when new comments are added.
// Click a comment → scrolls editor to anchor + opens thread bubble.

import { useState, useRef, useEffect } from 'react'
import { X } from 'lucide-react'
import type { CommentData } from '../../hooks/useComments'
import { relativeTime, getCommentDisplayName } from '../artifact-editor/editor-utils'

type Filter = 'all' | 'open' | 'resolved'

interface CommentPanelProps {
  comments: CommentData[]
  currentUserId: string
  onClickComment: (commentId: string) => void
  onClose: () => void
}

export function CommentPanel({
  comments,
  currentUserId,
  onClickComment,
  onClose,
}: CommentPanelProps) {
  const [filter, setFilter] = useState<Filter>('all')
  const scrollRef = useRef<HTMLDivElement>(null)
  const prevCountRef = useRef(comments.length)

  const filtered = comments.filter((c) => {
    if (filter === 'open') return !c.resolved && c.status === 'active'
    if (filter === 'resolved') return c.resolved
    return true
  })

  // Scroll to bottom on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [])

  // Scroll to bottom when new comments are added
  useEffect(() => {
    if (comments.length > prevCountRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
    prevCountRef.current = comments.length
  }, [comments.length])

  return (
    <div className="w-72 h-full shrink-0 border-l border-border bg-surface flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-border-subtle">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-medium text-fg">Comments</span>
          <button
            onClick={onClose}
            className="p-0.5 text-fg-tertiary hover:text-fg-secondary rounded transition-colors"
          >
            <X size={13} />
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex items-center gap-1">
          {(['all', 'open', 'resolved'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 text-[10px] font-medium rounded-full transition-colors ${
                filter === f
                  ? 'bg-fg text-fg-inverse'
                  : 'text-fg-tertiary hover:text-fg-secondary hover:bg-surface-hover'
              }`}
            >
              {f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Resolved'}
            </button>
          ))}
        </div>
      </div>

      {/* Comments list — own scroll */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 && (
          <div className="px-3 py-8 text-center text-[12px] text-fg-tertiary">
            {filter === 'all' ? 'No comments yet' :
             filter === 'open' ? 'No open comments' :
             'No resolved comments'}
          </div>
        )}

        {filtered.map((comment) => {
          const isOwn = comment.author === currentUserId
          const displayName = getCommentDisplayName(comment)
          const isOutdated = comment.status === 'outdated'

          return (
            <div
              key={comment.id}
              className={`px-3 py-2 border-b border-border-subtle transition-colors ${
                isOutdated
                  ? 'opacity-40'
                  : 'cursor-pointer hover:bg-surface-hover'
              }`}
              onClick={() => {
                if (!isOutdated) onClickComment(comment.id)
              }}
            >
              {/* Row 1: Anchor text */}
              <span
                className={`text-[10px] px-1 py-0.5 rounded italic inline-block mb-1 ${
                  isOutdated
                    ? 'bg-surface-active text-fg-tertiary'
                    : 'bg-yellow-500/10 text-yellow-700'
                }`}
              >
                &ldquo;{comment.anchorText.length > 50
                  ? comment.anchorText.substring(0, 50) + '...'
                  : comment.anchorText}&rdquo;
              </span>

              {/* Row 2: Name + time */}
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[11px] font-medium text-fg-secondary">
                  {isOwn ? 'You' : displayName}
                </span>
                {comment.resolved && (
                  <span className="text-[9px] text-green-600 font-medium">resolved</span>
                )}
                <span className="text-[10px] text-fg-tertiary ml-auto shrink-0">
                  {relativeTime(comment.createdAt)}
                  {comment.editedAt ? ' (edited)' : ''}
                </span>
              </div>

              {/* Row 3: Comment text */}
              <p className="text-[11px] text-fg leading-relaxed">
                {comment.text}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

