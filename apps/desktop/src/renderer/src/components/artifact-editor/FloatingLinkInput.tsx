// ─── FloatingLinkInput ──────────────────────────────────────────────────────
// Small popover near the text selection for entering/editing a link URL.
// Shows "Apply" for new links, "Update" + "Remove" for existing links.

import { useState, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/core'

interface FloatingLinkInputProps {
  editor: Editor
  position: { top: number; left: number }
  existingUrl: string
  onClose: () => void
}

export function FloatingLinkInput({ editor, position, existingUrl, onClose }: FloatingLinkInputProps) {
  const [url, setUrl] = useState(existingUrl)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    if (existingUrl) inputRef.current?.select()
  }, [existingUrl])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const apply = () => {
    const trimmed = url.trim()
    if (trimmed) {
      editor.chain().focus().setLink({ href: trimmed }).run()
    } else {
      editor.chain().focus().unsetLink().run()
    }
    onClose()
  }

  const remove = () => {
    editor.chain().focus().unsetLink().run()
    onClose()
  }

  return (
    <div
      ref={containerRef}
      className="absolute z-50 bg-surface-elevated border border-border rounded-lg shadow-lg flex items-center gap-1.5 px-2 py-1.5"
      style={{ top: position.top, left: Math.max(0, position.left) }}
    >
      <input
        ref={inputRef}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply()
          if (e.key === 'Escape') onClose()
        }}
        placeholder="Paste link URL..."
        className="text-[12px] bg-transparent text-fg outline-none placeholder:text-fg-tertiary min-w-[220px]"
      />
      <button
        onClick={apply}
        className="text-[10px] font-medium text-fg-inverse bg-fg px-2 py-0.5 rounded hover:opacity-90 transition-opacity shrink-0"
      >
        {existingUrl ? 'Update' : 'Apply'}
      </button>
      {existingUrl && (
        <button
          onClick={remove}
          className="text-[10px] text-fg-tertiary hover:text-red-500 transition-colors shrink-0"
        >
          Remove
        </button>
      )}
    </div>
  )
}
