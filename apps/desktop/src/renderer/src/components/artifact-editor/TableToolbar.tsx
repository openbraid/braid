// ─── TableToolbar ────────────────────────────────────────────────────────────
// Compact floating toolbar that appears above the table when cursor is inside
// a table cell. Provides add/remove row/column and delete table controls.
//
// Uses fixed positioning so the toolbar stays visible when the table is
// scrolled — it clamps to the top of the nearest scroll container, similar
// to Confluence / Coda table toolbars.

import { useEffect, useState, useCallback } from 'react'
import type { Editor } from '@tiptap/core'
import { TABLE_TOOLBAR_OFFSET_PX } from './editor-constants'
import {
  ArrowUpFromLine,
  ArrowDownFromLine,
  ArrowLeftFromLine,
  ArrowRightFromLine,
  Columns3,
  Rows3,
  Trash2
} from 'lucide-react'

interface TableToolbarProps {
  editor: Editor
}

/** Find the nearest scrollable ancestor of an element. */
function findScrollParent(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement
  while (current) {
    const { overflowY } = getComputedStyle(current)
    if (overflowY === 'auto' || overflowY === 'scroll') return current
    current = current.parentElement
  }
  return null
}

/** Find the sticky artifact header by walking up from an element. */
function findArtifactHeader(el: HTMLElement): HTMLElement | null {
  let current = el.parentElement
  while (current) {
    const header = current.querySelector(':scope > [data-artifact-header]')
    if (header instanceof HTMLElement) return header
    current = current.parentElement
  }
  return null
}

export function TableToolbar({ editor }: TableToolbarProps) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })

  const updatePosition = useCallback(() => {
    if (!editor.isActive('table')) {
      setVisible(false)
      return
    }

    // Walk up the ProseMirror doc to find the table node
    const { $from } = editor.state.selection
    let depth = $from.depth
    while (depth > 0) {
      const node = $from.node(depth)
      if (node.type.name === 'table') break
      depth--
    }
    if (depth === 0) {
      setVisible(false)
      return
    }

    const tablePos = $from.before(depth)
    const dom = editor.view.nodeDOM(tablePos)
    if (!dom || !(dom instanceof HTMLElement)) {
      setVisible(false)
      return
    }

    const tableRect = dom.getBoundingClientRect()
    const scrollParent = findScrollParent(dom)
    const scrollRect = scrollParent?.getBoundingClientRect()

    // Hide if the table is fully out of the visible scroll area
    if (scrollRect) {
      if (tableRect.bottom < scrollRect.top || tableRect.top > scrollRect.bottom) {
        setVisible(false)
        return
      }
    }

    // Clamp below the sticky artifact header (title + tabs + editor toolbar).
    const artifactHeader = findArtifactHeader(dom)
    const headerBottom = artifactHeader?.getBoundingClientRect().bottom

    // Ideal position: just above the table top
    const idealTop = tableRect.top - TABLE_TOOLBAR_OFFSET_PX
    // Clamp: never above the header bottom (when present), else scroll container top
    const minTop = headerBottom ?? scrollRect?.top ?? 0
    const top = Math.max(idealTop, minTop)

    setPosition({ top, left: tableRect.left })
    setVisible(true)
  }, [editor])

  useEffect(() => {
    const handleUpdate = () => updatePosition()
    editor.on('selectionUpdate', handleUpdate)
    editor.on('focus', handleUpdate)
    return () => {
      editor.off('selectionUpdate', handleUpdate)
      editor.off('focus', handleUpdate)
    }
  }, [editor, updatePosition])

  // Reposition on scroll and resize while visible
  useEffect(() => {
    if (!visible) return

    // Find the scroll parent once and listen on it (plus window for resize)
    const editorDom = editor.view.dom
    const scrollParent = findScrollParent(editorDom)

    const handleReposition = () => updatePosition()

    scrollParent?.addEventListener('scroll', handleReposition, { passive: true })
    window.addEventListener('resize', handleReposition)
    return () => {
      scrollParent?.removeEventListener('scroll', handleReposition)
      window.removeEventListener('resize', handleReposition)
    }
  }, [visible, editor, updatePosition])

  if (!visible) return null

  return (
    <div
      className="fixed z-40 flex items-center gap-0.5 bg-surface-elevated border border-border rounded-md shadow-md px-1 py-0.5"
      style={{ top: position.top, left: position.left }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <Btn onClick={() => editor.chain().focus().addRowBefore().run()} title="Add row above">
        <ArrowUpFromLine size={12} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().addRowAfter().run()} title="Add row below">
        <ArrowDownFromLine size={12} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row">
        <Rows3 size={12} />
        <span className="text-[8px] text-red-400 absolute -top-0.5 -right-0.5">×</span>
      </Btn>

      <Divider />

      <Btn onClick={() => editor.chain().focus().addColumnBefore().run()} title="Add column left">
        <ArrowLeftFromLine size={12} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().addColumnAfter().run()} title="Add column right">
        <ArrowRightFromLine size={12} />
      </Btn>
      <Btn onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column">
        <Columns3 size={12} />
        <span className="text-[8px] text-red-400 absolute -top-0.5 -right-0.5">×</span>
      </Btn>

      <Divider />

      <Btn onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table" danger>
        <Trash2 size={12} />
      </Btn>
    </div>
  )
}

function Divider() {
  return <div className="w-px h-3.5 bg-border-subtle mx-0.5" />
}

function Btn({ onClick, title, children, danger = false }: { onClick: () => void; title: string; children: React.ReactNode; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`relative p-1 rounded transition-colors ${
        danger
          ? 'text-fg-tertiary hover:text-red-500 hover:bg-red-500/10'
          : 'text-fg-tertiary hover:text-fg-secondary hover:bg-surface-hover'
      }`}
    >
      {children}
    </button>
  )
}
