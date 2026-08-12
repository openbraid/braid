// ─── EditorToolbar ──────────────────────────────────────────────────────────
// Static formatting toolbar that sits above the editor content.
// Always visible — does not require text selection (unlike BubbleMenu).

import { useState, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/core'
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Minus,
  Table,
  Code2,
  ChevronDown,
  Pilcrow,
  Link,
  ImageIcon
} from 'lucide-react'

type EditorToolbarProps = {
  editor: Editor | null
  onLinkClick?: () => void
}

export function EditorToolbar({ editor, onLinkClick }: EditorToolbarProps) {
  const [imageInputOpen, setImageInputOpen] = useState(false)

  if (!editor) return null

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-border-subtle bg-surface relative">
      {/* Block type dropdown */}
      <BlockTypeDropdown editor={editor} />

      <Divider />

      {/* Inline formatting */}
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive('bold')}
        title="Bold"
      >
        <Bold size={13} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive('italic')}
        title="Italic"
      >
        <Italic size={13} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive('strike')}
        title="Strikethrough"
      >
        <Strikethrough size={13} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive('code')}
        title="Inline code"
      >
        <Code size={13} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => {
          setImageInputOpen(false)
          onLinkClick?.()
        }}
        active={editor.isActive('link')}
        title="Link (Cmd+K)"
      >
        <Link size={13} />
      </ToolbarBtn>

      <Divider />

      {/* Lists & blocks */}
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive('bulletList')}
        title="Bullet list"
      >
        <List size={13} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive('orderedList')}
        title="Numbered list"
      >
        <ListOrdered size={13} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleTaskList().run()}
        active={editor.isActive('taskList')}
        title="Task list"
      >
        <ListChecks size={13} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive('blockquote')}
        title="Quote"
      >
        <Quote size={13} />
      </ToolbarBtn>

      <Divider />

      {/* Insert blocks */}
      <ToolbarBtn
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        active={false}
        title="Insert table"
      >
        <Table size={13} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => setImageInputOpen(!imageInputOpen)}
        active={false}
        title="Insert image"
      >
        <ImageIcon size={13} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        active={editor.isActive('codeBlock')}
        title="Code block"
      >
        <Code2 size={13} />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
        active={false}
        title="Divider"
      >
        <Minus size={13} />
      </ToolbarBtn>

      {/* Image URL input popover */}
      {imageInputOpen && (
        <UrlInput
          placeholder="Paste image URL..."
          onSubmit={(url) => {
            editor.chain().focus().setImage({ src: url }).run()
            setImageInputOpen(false)
          }}
          onClose={() => setImageInputOpen(false)}
        />
      )}
    </div>
  )
}

// ─── Generic URL input (for image) ──────────────────────────────────────────

function UrlInput({
  placeholder,
  onSubmit,
  onClose,
}: {
  placeholder: string
  onSubmit: (url: string) => void
  onClose: () => void
}) {
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  return (
    <div
      ref={containerRef}
      className="absolute top-full left-0 mt-1 ml-2 bg-surface-elevated border border-border rounded-lg shadow-lg z-50 flex items-center gap-1.5 px-2 py-1.5"
    >
      <input
        ref={inputRef}
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && url.trim()) onSubmit(url.trim())
          if (e.key === 'Escape') onClose()
        }}
        placeholder={placeholder}
        className="text-[12px] bg-transparent text-fg outline-none placeholder:text-fg-tertiary min-w-[220px]"
      />
      <button
        onClick={() => { if (url.trim()) onSubmit(url.trim()) }}
        disabled={!url.trim()}
        className="text-[10px] font-medium text-fg-inverse bg-fg px-2 py-0.5 rounded hover:opacity-90 transition-opacity shrink-0 disabled:opacity-30"
      >
        Insert
      </button>
    </div>
  )
}

// ─── Block type dropdown ──────────────────────────────────────────────────────

const BLOCK_TYPES = [
  { label: 'Normal', icon: Pilcrow, command: (e: Editor) => e.chain().focus().setParagraph().run() },
  { label: 'Heading 1', icon: Heading1, command: (e: Editor) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: 'Heading 2', icon: Heading2, command: (e: Editor) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: 'Heading 3', icon: Heading3, command: (e: Editor) => e.chain().focus().toggleHeading({ level: 3 }).run() },
]

function BlockTypeDropdown({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = editor.isActive('heading', { level: 1 })
    ? 'Heading 1'
    : editor.isActive('heading', { level: 2 })
    ? 'Heading 2'
    : editor.isActive('heading', { level: 3 })
    ? 'Heading 3'
    : 'Normal'

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-[11px] text-fg-secondary hover:bg-surface-hover rounded transition-colors min-w-[80px]"
      >
        <span>{current}</span>
        <ChevronDown size={10} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface-elevated border border-border rounded-md shadow-lg z-50 py-1 min-w-[140px]">
          {BLOCK_TYPES.map(({ label, icon: Icon, command }) => (
            <button
              key={label}
              onClick={() => { command(editor); setOpen(false) }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-surface-hover transition-colors ${
                current === label ? 'text-brand font-medium' : 'text-fg-secondary'
              }`}
            >
              <Icon size={13} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Shared pieces ────────────────────────────────────────────────────────────

function Divider() {
  return <div className="w-px h-4 bg-border-subtle mx-1" />
}

function ToolbarBtn({
  onClick,
  active,
  title,
  children
}: {
  onClick: () => void
  active: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-surface-active text-fg'
          : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}
