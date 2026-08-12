// ─── StructuredTable ──────────────────────────────────────────────────────────
// Generic table component that renders any YAML array section.
// Columns are auto-detected from the data — no hardcoded schemas.
//
// Fixed columns: id (mono, first), title (editable, second)
// Dynamic columns: auto-detected render mode per column:
//   - dropdown (combobox) for low-cardinality columns (≤8 unique values, ≥3 rows)
//   - plain text with autocomplete for everything else
// Expandable: if items have a description field → expandable row with rich editor

import { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronRight, Plus, Trash2 } from 'lucide-react'
import { Editor, Extension } from '@tiptap/core'
import Collaboration from '@tiptap/extension-collaboration'
import * as Y from 'yjs'
import { ArtifactEditor } from '../artifact-editor/ArtifactEditor'
import type { CommentBubbleProps } from '../comments/CommentBubble'
import { getBaseExtensions } from '../artifact-editor/editor-extensions'
import { createCommentDecorationsPlugin } from '../artifact-editor/extensions/comment-decorations'
import type { StructuredItem } from '../../hooks/useYjsArtifact'
import { getColumnRenderMode, getDropdownOptions } from './column-utils'
import { CellCombobox } from './CellCombobox'
import { SECTION_LABELS } from './constants'

// ─── Types ───────────────────────────────────────────────────────────────────

/** Fields that are never shown as table columns */
const HIDDEN_FIELDS = new Set(['id', 'title', 'description', 'tags'])

/**
 * A YAML field can hold a nested mapping or a list of mappings — agents write
 * these freely. A table cell cannot edit one, and `String()` on it yields
 * "[object Object]", so these render read-only with a summary instead.
 *
 * Making them read-only is the point, not a limitation: committing an edit here
 * would replace the whole structure with the text in the input and destroy it.
 * Dates are scalars for display purposes.
 */
function isStructuredValue(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !(value instanceof Date)
}

/** Compact one-line summary of a nested value, for a cell that cannot show it all. */
function summariseStructuredValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `${value.length} ${value.length === 1 ? 'entry' : 'entries'}`
  }
  const entries = Object.entries(value as Record<string, unknown>)
  return entries
    .map(([key, inner]) => `${key}: ${isStructuredValue(inner) ? '…' : String(inner)}`)
    .join('  ·  ')
}

interface StructuredTableProps {
  items: StructuredItem[]
  arrayName: string
  // Local mode
  onChange?: (items: StructuredItem[]) => void
  readOnly?: boolean
  // Shared mode (Yjs)
  ydoc?: Y.Doc | null
  onFieldChange?: (index: number, field: string, value: string) => void
  onAdd?: (item: Record<string, string>) => void
  onRemove?: (index: number) => void
  // Comments
  onCommentClick?: (selection: { from: number; to: number; text: string }, fragmentName: string, sourceEditor: Editor | null) => void
  commentBubbleProps?: CommentBubbleProps | null
}

// ─── Column discovery ────────────────────────────────────────────────────────

interface ColumnDef {
  field: string
  label: string
}

function discoverColumns(items: StructuredItem[]): ColumnDef[] {
  const fieldSet = new Set<string>()
  for (const item of items) {
    for (const key of Object.keys(item)) {
      if (!HIDDEN_FIELDS.has(key)) fieldSet.add(key)
    }
  }

  return [...fieldSet].map((field) => ({
    field,
    label: field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
  }))
}

// ─── Autocomplete helper ─────────────────────────────────────────────────────

function getColumnValues(items: StructuredItem[], field: string): string[] {
  const values = new Set<string>()
  for (const item of items) {
    const val = item[field]
    if (typeof val === 'string' && val.trim()) values.add(val)
  }
  return [...values].sort()
}

// ─── Main component ─────────────────────────────────────────────────────────

// Dynamic-column resize bounds. Narrow enough to keep cells usable, wide
// enough to accommodate long dropdown values. Session-only state.
const DEFAULT_COL_WIDTH = 96
const MIN_COL_WIDTH = 48
const MAX_COL_WIDTH = 480

export function StructuredTable({
  items,
  arrayName,
  onChange,
  readOnly = false,
  ydoc,
  onFieldChange,
  onAdd,
  onRemove,
  onCommentClick,
  commentBubbleProps,
}: StructuredTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const isSharedMode = !!onFieldChange

  const columns = useMemo(() => discoverColumns(items), [items])
  const hasDescription = useMemo(
    () => items.some((item) => 'description' in item),
    [items]
  )

  // Per-column widths for user-resizable dynamic columns. Session-only for V0 —
  // resets on reload. Persistence can be added later once the UX is validated.
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({})
  const getColWidth = (field: string): number => columnWidths[field] ?? DEFAULT_COL_WIDTH

  function startColResize(field: string, e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startWidth = getColWidth(field)

    function onMove(ev: PointerEvent) {
      const next = Math.max(MIN_COL_WIDTH, Math.min(MAX_COL_WIDTH, startWidth + (ev.clientX - startX)))
      setColumnWidths((prev) => ({ ...prev, [field]: next }))
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  // Pre-compute render mode + dropdown options per column (avoids per-row recalc)
  const columnModes = useMemo(() => {
    const modes: Record<string, { mode: 'dropdown' | 'text'; options: string[] }> = {}
    for (const col of columns) {
      const mode = getColumnRenderMode(items, col.field)
      modes[col.field] = {
        mode,
        options: mode === 'dropdown' ? getDropdownOptions(items, col.field) : [],
      }
    }
    return modes
  }, [items, columns])

  // ─── Mutations ─────────────────────────────────────────────────────

  function handleFieldChange(itemId: string, field: string, value: string) {
    if (readOnly) return
    if (isSharedMode) {
      const idx = items.findIndex((item) => item.id === itemId)
      if (idx !== -1) onFieldChange!(idx, field, value)
    } else if (onChange) {
      onChange(items.map((item) =>
        item.id === itemId ? { ...item, [field]: value } : item
      ))
    }
  }

  function handleRemove(itemId: string) {
    if (readOnly) return
    if (isSharedMode && onRemove) {
      const idx = items.findIndex((item) => item.id === itemId)
      if (idx !== -1) onRemove(idx)
    } else if (onChange) {
      onChange(items.filter((item) => item.id !== itemId))
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (items.length === 0 && readOnly) return null

  const sectionLabel = SECTION_LABELS[arrayName] ??
    arrayName.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <div className="mt-3">
      {/* Section heading */}
      <div className="flex items-center justify-between px-4 pt-2 pb-1">
        <h3 className="text-[12px] font-semibold text-fg-secondary">{sectionLabel}</h3>
      </div>

      {/* Add button */}
      {!readOnly && onAdd && (
        <div className="flex items-center px-4 pt-3 pb-2">
          <button
            onClick={() => {
              const nextNum = items.length + 1
              const prefix = arrayName === 'requirements' ? 'REQ' :
                arrayName === 'task_list' ? 'TASK' :
                arrayName === 'test_cases' ? 'TC' :
                arrayName === 'security_checks' ? 'SEC' :
                arrayName === 'action_items' ? 'ACT' : 'ITEM'
              onAdd({ id: `${prefix}-${String(nextNum).padStart(3, '0')}`, title: '' })
            }}
            className="px-3 py-1.5 rounded text-[11px] font-medium bg-fg text-fg-inverse hover:opacity-90 transition-opacity flex items-center gap-1.5"
          >
            <Plus size={11} />
            Add Item
          </button>
        </div>
      )}

      {/* Table */}
      <div className="border border-border-subtle rounded-lg overflow-x-auto mx-4 mb-4">
        {/* Header */}
        <div className="bg-surface-secondary border-b border-border-subtle">
          <div className="flex items-center gap-3 px-3 py-2 text-[11px] font-medium text-fg-secondary">
            {hasDescription && <div className="w-5 shrink-0" />}
            <div className="w-16 shrink-0">ID</div>
            <div className="flex-1 min-w-[120px]">Title</div>
            {columns.map((col) => (
              <div
                key={col.field}
                className="shrink-0 relative truncate"
                style={{ width: getColWidth(col.field) }}
              >
                {col.label}
                {/* Drag handle — 12px-wide click target straddling the column's right
                    edge, with an always-visible 2px bar inside so the affordance
                    reads without hover discovery. */}
                <div
                  onPointerDown={(e) => startColResize(col.field, e)}
                  className="group/resize absolute -right-1.5 top-0 bottom-0 w-3 cursor-col-resize z-10 flex justify-center"
                  title="Drag to resize"
                >
                  <div className="w-0.5 h-full bg-border-strong group-hover/resize:bg-fg-tertiary transition-colors" />
                </div>
              </div>
            ))}
            {!readOnly && <div className="w-8 shrink-0" />}
          </div>
        </div>

        {/* Rows */}
        <div className="divide-y divide-border-subtle">
          {items.map((item) => (
            <StructuredRow
              key={item.id}
              item={item}
              columns={columns}
              columnModes={columnModes}
              columnWidths={columnWidths}
              allItems={items}
              arrayName={arrayName}
              hasDescription={hasDescription}
              isExpanded={expandedIds.has(item.id)}
              readOnly={readOnly}
              ydoc={ydoc}
              onToggleExpand={() => toggleExpand(item.id)}
              onFieldChange={(field, value) => handleFieldChange(item.id, field, value)}
              onRemove={() => handleRemove(item.id)}
              onCommentClick={onCommentClick}
              commentBubbleProps={commentBubbleProps}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function StructuredRow({
  item,
  columns,
  columnModes,
  columnWidths,
  allItems,
  arrayName,
  hasDescription,
  isExpanded,
  readOnly,
  ydoc,
  onToggleExpand,
  onFieldChange,
  onRemove,
  onCommentClick,
  commentBubbleProps,
}: {
  item: StructuredItem
  columns: ColumnDef[]
  columnModes: Record<string, { mode: 'dropdown' | 'text'; options: string[] }>
  columnWidths: Record<string, number>
  allItems: StructuredItem[]
  arrayName: string
  hasDescription: boolean
  isExpanded: boolean
  readOnly: boolean
  ydoc?: Y.Doc | null
  onToggleExpand: () => void
  onFieldChange: (field: string, value: string) => void
  onRemove: () => void
  onCommentClick?: (selection: { from: number; to: number; text: string }, fragmentName: string, sourceEditor: Editor | null) => void
  commentBubbleProps?: CommentBubbleProps | null
}) {
  const [editingField, setEditingField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [autocompleteOptions, setAutocompleteOptions] = useState<string[]>([])
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const fragmentName = `${arrayName}:${item.id}:description`
  const descEditor = useDescriptionEditor(ydoc ?? null, fragmentName, isExpanded)

  const handleCommentClick = useMemo(() => {
    if (!onCommentClick) return undefined
    return (selection: { from: number; to: number; text: string }) => {
      onCommentClick(selection, fragmentName, descEditor)
    }
  }, [onCommentClick, fragmentName, descEditor])

  // Start editing a cell
  function startEdit(field: string, currentValue: string) {
    if (readOnly || field === 'id') return
    setEditingField(field)
    setEditValue(currentValue)
    const { mode, options } = columnModes[field] ?? { mode: 'text' as const, options: [] }
    if (mode === 'dropdown') {
      // Dropdown columns: show all options immediately (including current value for context)
      setAutocompleteOptions(options)
      setShowAutocomplete(true)
    } else {
      // Text columns: show suggestions only when typing
      setAutocompleteOptions(getColumnValues(allItems, field).filter((v) => v !== currentValue))
      setShowAutocomplete(false)
    }
  }

  function commitEdit(field: string) {
    setEditingField(null)
    setShowAutocomplete(false)
    const currentValue = String(item[field] ?? '')
    if (editValue !== currentValue) {
      onFieldChange(field, editValue)
    }
  }

  function handleEditKeyDown(e: React.KeyboardEvent, field: string) {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      commitEdit(field)
    } else if (e.key === 'Escape') {
      setEditingField(null)
      setShowAutocomplete(false)
    }
  }

  // Filter suggestions based on column mode:
  // - Dropdown columns: show all options, filter as user types (but don't exclude current)
  // - Text columns: show only matching options, exclude current value
  const isDropdownMode = editingField ? (columnModes[editingField]?.mode === 'dropdown') : false
  const filteredOptions = autocompleteOptions.filter((opt) => {
    const matchesInput = opt.toLowerCase().includes(editValue.toLowerCase())
    if (isDropdownMode) return matchesInput
    return matchesInput && opt !== editValue
  })

  return (
    <div className="bg-surface hover:bg-surface-hover transition-colors">
      {/* Row */}
      <div className="flex items-center gap-3 px-3 py-2.5 text-[12px]">
        {/* Expand chevron */}
        {hasDescription && (
          <div className="w-5 shrink-0 flex items-center justify-center">
            <button
              onClick={onToggleExpand}
              className="p-0.5 hover:bg-surface-active rounded text-fg-tertiary"
            >
              <ChevronRight
                size={12}
                className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              />
            </button>
          </div>
        )}

        {/* ID */}
        <div className="w-16 shrink-0 font-mono text-[11px] text-fg-secondary">
          {item.id}
        </div>

        {/* Title */}
        <div className="flex-1 min-w-[120px]">
          {editingField === 'title' ? (
            <input
              ref={inputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => commitEdit('title')}
              onKeyDown={(e) => handleEditKeyDown(e, 'title')}
              autoFocus
              className="w-full px-2 py-1 rounded border border-border bg-surface-secondary text-fg text-[12px] outline-none focus:border-border-strong"
            />
          ) : (
            <button
              onClick={() => startEdit('title', String(item.title ?? ''))}
              className="w-full text-left px-2 py-1 rounded hover:bg-surface-active text-fg transition-colors text-[12px] truncate"
            >
              {String(item.title ?? '') || <span className="text-fg-tertiary italic">Untitled</span>}
            </button>
          )}
        </div>

        {/* Dynamic columns */}
        {columns.map((col) => {
          const rawValue = item[col.field]
          const structured = isStructuredValue(rawValue)
          const value = structured ? '' : String(rawValue ?? '')
          const { mode, options } = columnModes[col.field] ?? { mode: 'text' as const, options: [] }
          const isEditing = editingField === col.field

          return (
            <div
              key={col.field}
              className="shrink-0 relative"
              style={{ width: columnWidths[col.field] ?? DEFAULT_COL_WIDTH }}
            >
              {structured ? (
                /* ── Nested mapping or list: read-only, edit it in the file ── */
                <div
                  title={`Nested value — edit this field in the YAML file.\n\n${JSON.stringify(rawValue, null, 2)}`}
                  className="w-full px-2 py-1 rounded text-[11px] text-fg-tertiary italic truncate cursor-default"
                >
                  {summariseStructuredValue(rawValue)}
                </div>
              ) : mode === 'dropdown' ? (
                /* ── Combobox for low-cardinality columns ── */
                <CellCombobox
                  value={value}
                  options={options}
                  readOnly={readOnly}
                  onSelect={(v) => onFieldChange(col.field, v)}
                  onClose={() => {}}
                />
              ) : isEditing ? (
                /* ── Text input with autocomplete for free-text columns ── */
                <div className="relative">
                  <input
                    ref={inputRef}
                    type="text"
                    value={editValue}
                    onChange={(e) => {
                      setEditValue(e.target.value)
                      setShowAutocomplete(true)
                    }}
                    onBlur={() => {
                      setTimeout(() => commitEdit(col.field), 150)
                    }}
                    onKeyDown={(e) => handleEditKeyDown(e, col.field)}
                    onFocus={() => setShowAutocomplete(true)}
                    autoFocus
                    placeholder="empty"
                    className="w-full px-2 py-1 rounded border border-border bg-surface-secondary text-fg text-[11px] outline-none focus:border-border-strong placeholder:text-fg-tertiary"
                  />
                  {showAutocomplete && filteredOptions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-md shadow-lg z-10 max-h-32 overflow-y-auto">
                      {filteredOptions.map((opt) => (
                        <button
                          key={opt}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            setEditValue(opt)
                            setShowAutocomplete(false)
                            onFieldChange(col.field, opt)
                            setEditingField(null)
                          }}
                          className="w-full text-left px-2 py-1.5 text-[11px] text-fg-secondary hover:bg-surface-hover transition-colors"
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                /* ── Click-to-edit for free-text columns ── */
                <button
                  onClick={() => startEdit(col.field, value)}
                  className="w-full text-left px-2 py-1 rounded text-[11px] text-fg-secondary hover:bg-surface-active transition-colors truncate"
                  disabled={readOnly}
                >
                  {value || <span className="text-fg-tertiary">—</span>}
                </button>
              )}
            </div>
          )
        })}

        {/* Delete */}
        {!readOnly && (
          <div className="w-8 shrink-0 flex items-center justify-center">
            <button
              onClick={onRemove}
              className="p-1 hover:bg-surface-active rounded text-fg-tertiary hover:text-error transition-colors"
            >
              <Trash2 size={11} />
            </button>
          </div>
        )}
      </div>

      {/* Expanded description */}
      {hasDescription && isExpanded && (
        <div className="border-t border-border-subtle pl-11">
          {ydoc && descEditor ? (
            <ArtifactEditor
              externalEditor={descEditor}
              onCommentClick={handleCommentClick}
              fragmentName={fragmentName}
              commentBubbleProps={commentBubbleProps}
            />
          ) : (
            <ArtifactEditor
              content={String(item.description ?? '')}
              onChange={readOnly ? undefined : (md) => onFieldChange('description', md)}
              readOnly={readOnly}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── Per-row Collaboration editor hook ──────────────────────────────────────

function useDescriptionEditor(
  ydoc: Y.Doc | null,
  fragmentName: string,
  isExpanded: boolean,
): Editor | null {
  const [editor, setEditor] = useState<Editor | null>(null)
  const editorRef = useRef<Editor | null>(null)

  useEffect(() => {
    if (!ydoc || !isExpanded) {
      if (editorRef.current) {
        editorRef.current.destroy()
        editorRef.current = null
        setEditor(null)
      }
      return
    }

    const newEditor = new Editor({
      extensions: [
        ...getBaseExtensions(),
        Collaboration.configure({
          document: ydoc,
          field: fragmentName,
        }),
        Extension.create({
          name: 'commentDecorations',
          addProseMirrorPlugins: () => [
            createCommentDecorationsPlugin({ ydoc, fragmentName, editorRef }),
          ],
        }),
      ],
      editorProps: {
        attributes: {
          class: 'artifact-editor-content outline-none',
        },
      },
    })

    editorRef.current = newEditor
    setEditor(newEditor)

    return () => {
      newEditor.destroy()
      editorRef.current = null
      setEditor(null)
    }
  }, [ydoc, fragmentName, isExpanded])

  return editor
}
