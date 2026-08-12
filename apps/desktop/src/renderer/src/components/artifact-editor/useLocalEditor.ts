// ─── useLocalEditor ──────────────────────────────────────────────────────────
// Creates a local (non-Yjs) Tiptap editor for Local mode.
// Handles content sync from external prop changes and debounced onChange.

import { useCallback, useEffect, useRef } from 'react'
import { useEditor } from '@tiptap/react'
import { getBaseExtensions } from './editor-extensions'
import { CONTENT_CHANGE_DEBOUNCE_MS } from './editor-constants'

interface UseLocalEditorOptions {
  content?: string
  onChange?: (markdown: string) => void
  readOnly?: boolean
  /** If true, skip creating a local editor (Shared mode uses externalEditor). */
  skip?: boolean
}

export function useLocalEditor({ content, onChange, readOnly = false, skip = false }: UseLocalEditorOptions) {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const userEditedRef = useRef(false)
  const suppressOnChangeRef = useRef(false)
  const lastContentRef = useRef(content)
  const lastEmittedRef = useRef<string | null>(null)

  const handleUpdate = useCallback(
    ({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) => {
      if (!onChange) return
      if (suppressOnChangeRef.current) return
      if (!userEditedRef.current) return

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const storage = editor.storage as unknown as Record<string, { getMarkdown?: () => string }>
        const md = storage.markdown?.getMarkdown?.()
        if (md != null) {
          lastEmittedRef.current = md
          onChange(md)
        }
      }, CONTENT_CHANGE_DEBOUNCE_MS)
    },
    [onChange]
  )

  const editor = useEditor({
    extensions: getBaseExtensions(),
    content: content ?? '',
    editable: !readOnly && !skip,
    onUpdate: handleUpdate,
    onTransaction: ({ transaction }) => {
      if (transaction.docChanged && transaction.steps.length > 0 && !suppressOnChangeRef.current) {
        userEditedRef.current = true
      }
    },
    editorProps: {
      attributes: { class: 'artifact-editor-content outline-none' }
    }
  })

  // Sync content prop changes into the editor
  useEffect(() => {
    if (skip || !editor) return
    if (content === lastContentRef.current) return
    lastContentRef.current = content ?? ''

    // Skip setContent if this is our own edit echoed back via onChange → parent → content prop.
    // Only apply setContent for genuine external changes (e.g., loading a different artifact).
    if (content === lastEmittedRef.current) {
      lastEmittedRef.current = null
      return
    }

    suppressOnChangeRef.current = true
    userEditedRef.current = false
    editor.commands.setContent(content ?? '')

    requestAnimationFrame(() => {
      suppressOnChangeRef.current = false
    })
  }, [content, editor, skip])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return skip ? null : editor
}
