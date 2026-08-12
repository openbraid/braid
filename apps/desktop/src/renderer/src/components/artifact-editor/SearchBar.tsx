// ─── SearchBar ──────────────────────────────────────────────────────────────
// Inline search bar for per-artifact find. Triggered by cmd+F when the
// editor is focused, or via the search button in the toolbar.

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Editor } from '@tiptap/core'
import { X, ChevronUp, ChevronDown } from 'lucide-react'
import type { SearchStorage } from './extensions/search-highlight'

type SearchBarProps = {
  editor: Editor
  onClose: () => void
}

export function SearchBar({ editor, onClose }: SearchBarProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const storage = (editor.storage as unknown as Record<string, SearchStorage>).searchHighlight

  useEffect(() => {
    inputRef.current?.focus()
    // Clear search on unmount
    return () => {
      editor.commands.clearSearch()
    }
  }, [editor])

  const handleChange = useCallback((value: string) => {
    setQuery(value)
    editor.commands.setSearchQuery(value)
  }, [editor])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        editor.commands.prevSearchMatch()
      } else {
        editor.commands.nextSearchMatch()
      }
    }
  }, [editor, onClose])

  const matchCount = storage?.matchCount ?? 0
  const activeIndex = storage?.activeIndex ?? 0

  return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border-subtle bg-surface">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Find in document..."
        className="flex-1 min-w-0 text-[12px] bg-transparent text-fg outline-none placeholder:text-fg-tertiary"
      />

      {query && (
        <span className="text-[10px] text-fg-tertiary shrink-0 tabular-nums">
          {matchCount > 0 ? `${activeIndex + 1}/${matchCount}` : 'No results'}
        </span>
      )}

      <button
        onClick={() => editor.commands.prevSearchMatch()}
        disabled={matchCount === 0}
        className="p-0.5 text-fg-tertiary hover:text-fg-secondary transition-colors disabled:opacity-30"
        title="Previous (Shift+Enter)"
      >
        <ChevronUp size={13} />
      </button>
      <button
        onClick={() => editor.commands.nextSearchMatch()}
        disabled={matchCount === 0}
        className="p-0.5 text-fg-tertiary hover:text-fg-secondary transition-colors disabled:opacity-30"
        title="Next (Enter)"
      >
        <ChevronDown size={13} />
      </button>
      <button
        onClick={onClose}
        className="p-0.5 text-fg-tertiary hover:text-fg-secondary transition-colors"
        title="Close (Esc)"
      >
        <X size={13} />
      </button>
    </div>
  )
}
