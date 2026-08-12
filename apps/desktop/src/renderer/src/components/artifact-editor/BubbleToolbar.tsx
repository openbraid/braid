// ─── BubbleToolbar ──────────────────────────────────────────────────────────
// Floating toolbar that appears on text selection. Provides inline formatting,
// headings, lists, link, and comment buttons.

import type { Editor } from '@tiptap/core'
import { BubbleMenu } from '@tiptap/react/menus'
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
  Quote,
  Minus,
  MessageSquare,
  Link as LinkIcon
} from 'lucide-react'

interface BubbleToolbarProps {
  editor: Editor
  onLinkClick: () => void
  onCommentClick?: (selection: { from: number; to: number; text: string }) => void
}

export function BubbleToolbar({ editor, onLinkClick, onCommentClick }: BubbleToolbarProps) {
  return (
    <BubbleMenu
      editor={editor}
      className="bg-surface-elevated border border-border rounded-md shadow-lg flex items-center gap-0.5 px-1 py-1"
    >
      <Btn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="Bold">
        <Bold size={13} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="Italic">
        <Italic size={13} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough">
        <Strikethrough size={13} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Inline code">
        <Code size={13} />
      </Btn>

      <Divider />

      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1">
        <Heading1 size={13} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2">
        <Heading2 size={13} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3">
        <Heading3 size={13} />
      </Btn>

      <Divider />

      <Btn onClick={onLinkClick} active={editor.isActive('link')} title="Link (Cmd+K)">
        <LinkIcon size={13} />
      </Btn>

      <Divider />

      <Btn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list">
        <List size={13} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Numbered list">
        <ListOrdered size={13} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Quote">
        <Quote size={13} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().setHorizontalRule().run()} active={false} title="Divider">
        <Minus size={13} />
      </Btn>

      {onCommentClick && (
        <>
          <Divider />
          <Btn
            onClick={() => {
              const { from, to } = editor.state.selection
              const text = editor.state.doc.textBetween(from, to)
              if (text.trim()) onCommentClick({ from, to, text })
            }}
            active={false}
            title="Add comment"
          >
            <MessageSquare size={13} />
          </Btn>
        </>
      )}
    </BubbleMenu>
  )
}

function Divider() {
  return <div className="w-px h-4 bg-border-subtle mx-0.5" />
}

function Btn({ onClick, active, title, children }: { onClick: () => void; active: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active ? 'bg-surface-active text-fg' : 'text-fg-secondary hover:bg-surface-hover hover:text-fg'
      }`}
    >
      {children}
    </button>
  )
}
