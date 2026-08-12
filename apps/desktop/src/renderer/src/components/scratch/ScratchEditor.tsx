import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import { toast } from 'sonner'
import { getScratchExtensions } from './scratch-extensions'
import { ScratchBubbleToolbar } from './ScratchBubbleToolbar'
import { EditorToolbar } from '../artifact-editor/EditorToolbar'
import { FloatingLinkInput } from '../artifact-editor/FloatingLinkInput'
import { TableToolbar } from '../artifact-editor/TableToolbar'
import { getPositionRelativeToEditor } from '../artifact-editor/editor-utils'
import { EDITOR_CONTAINER_ATTR } from '../artifact-editor/editor-constants'
import { useScratchStore } from '../../store/scratch-store'
import { ipc } from '../../lib/ipc'
import { track } from '../../lib/analytics'
import { Channels } from '../../../../shared/ipc-types'
import '../artifact-editor/artifact-editor.css'

const SAVE_DEBOUNCE_MS = 500
const AUTO_TITLE_MIN_LENGTH = 3

export function ScratchEditor() {
  const activePageId = useScratchStore((s) => s.activePageId)
  const pages = useScratchStore((s) => s.pages)
  const updateContent = useScratchStore((s) => s.updateContent)
  const updateTitle = useScratchStore((s) => s.updateTitle)
  const setDictationState = useScratchStore((s) => s.setDictationState)
  const setDictationVolume = useScratchStore((s) => s.setDictationVolume)
  const setDictationStatus = useScratchStore((s) => s.setDictationStatus)

  const activePage = pages.find((p) => p.id === activePageId)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const currentPageIdRef = useRef<string | null>(null)
  const editorRef = useRef<ReturnType<typeof useEditor>>(null)
  const [linkInput, setLinkInput] = useState<{ top: number; left: number; existingUrl: string } | null>(null)

  const debouncedSave = useCallback(
    (id: string, json: string, textContent: string) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
      saveTimerRef.current = setTimeout(() => {
        updateContent(id, json, textContent)

        const page = useScratchStore.getState().pages.find((p) => p.id === id)
        if (page && !page.title && page.content) {
          const firstLine = textContent.split('\n')[0]?.trim()
          if (firstLine && firstLine.length >= AUTO_TITLE_MIN_LENGTH) {
            updateTitle(id, firstLine.slice(0, 60))
          }
        }
      }, SAVE_DEBOUNCE_MS)
    },
    [updateContent, updateTitle]
  )

  const editor = useEditor({
    extensions: getScratchExtensions(),
    editorProps: {
      attributes: {
        class: 'artifact-editor-content outline-none'
      }
    },
    content: {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 } }]
    },
    onUpdate: ({ editor: ed }) => {
      const pageId = currentPageIdRef.current
      if (!pageId) return

      // Enforce first node is always H1
      const firstNode = ed.state.doc.firstChild
      if (firstNode && firstNode.type.name !== 'heading') {
        const tr = ed.state.tr.setNodeMarkup(0, ed.schema.nodes.heading, { level: 1 })
        ed.view.dispatch(tr)
        return
      }
      if (firstNode && firstNode.type.name === 'heading' && firstNode.attrs.level !== 1) {
        const tr = ed.state.tr.setNodeMarkup(0, ed.schema.nodes.heading, { level: 1 })
        ed.view.dispatch(tr)
        return
      }

      const json = JSON.stringify(ed.getJSON())
      const textContent = ed.state.doc.textContent
      debouncedSave(pageId, json, textContent)
    }
  })

  editorRef.current = editor

  const openLinkInput = useCallback(() => {
    if (!editor) return
    const { from } = editor.state.selection
    const pos = getPositionRelativeToEditor(editor.view, from)
    if (!pos) return
    const existingUrl = (editor.getAttributes('link').href as string) ?? ''
    setLinkInput({ ...pos, existingUrl })
  }, [editor])

  // ─── Cmd+K shortcut for links ─────────────────────────────────────────────
  useEffect(() => {
    if (!editor) return
    const el = editor.view.dom
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        e.stopPropagation()
        openLinkInput()
      }
    }
    el.addEventListener('keydown', handleKeyDown)
    return () => el.removeEventListener('keydown', handleKeyDown)
  }, [editor, openLinkInput])

  // ─── Cmd+Click to open links in browser ───────────────────────────────────
  useEffect(() => {
    if (!editor) return
    const el = editor.view.dom
    const handleClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const anchor = (e.target as HTMLElement).closest('a')
      if (!anchor) return
      const href = anchor.getAttribute('href')
      if (href) {
        e.preventDefault()
        window.open(href, '_blank')
      }
    }
    el.addEventListener('click', handleClick)
    return () => el.removeEventListener('click', handleClick)
  }, [editor])

  // ─── Dictation push event listeners ────────────────────────────────────────

  useEffect(() => {
    const unsubVolume = ipc.on(Channels.SCRATCH_DICTATION_VOLUME, ({ levels }) => {
      setDictationVolume(levels)
    })

    const unsubResult = ipc.on(Channels.SCRATCH_DICTATION_RESULT, ({ text }) => {
      setDictationState('idle')
      track('scratch_dictation_used')
      const ed = editorRef.current
      if (ed && text.trim()) {
        // Insert transcribed text inline at cursor
        ed.chain().focus().insertContent(text).run()
      }
    })

    const unsubError = ipc.on(Channels.SCRATCH_DICTATION_ERROR, ({ error }) => {
      setDictationState('idle')
      toast(error)
    })

    const unsubStatus = ipc.on(Channels.SCRATCH_DICTATION_STATUS, ({ message }) => {
      setDictationStatus(message)
    })

    return () => {
      unsubVolume()
      unsubResult()
      unsubError()
      unsubStatus()
    }
  }, [setDictationState, setDictationVolume, setDictationStatus])

  // ─── Swap content when active page changes ─────────────────────────────────

  useEffect(() => {
    if (!editor || !activePage) return
    if (currentPageIdRef.current === activePage.id) return

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
      const prevId = currentPageIdRef.current
      if (prevId) {
        const json = JSON.stringify(editor.getJSON())
        const textContent = editor.state.doc.textContent
        updateContent(prevId, json, textContent)
      }
    }

    currentPageIdRef.current = activePage.id

    if (activePage.content) {
      try {
        editor.commands.setContent(JSON.parse(activePage.content))
      } catch {
        editor.commands.setContent({
          type: 'doc',
          content: [{ type: 'heading', attrs: { level: 1 } }]
        })
      }
    } else {
      editor.commands.setContent({
        type: 'doc',
        content: [{ type: 'heading', attrs: { level: 1 } }]
      })
    }
    editor.commands.focus('start')
  }, [editor, activePage, updateContent])

  if (!activePage) {
    return (
      <div className="flex items-center justify-center h-full text-fg-tertiary text-[13px]">
        No pages yet
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <EditorToolbar editor={editor} onLinkClick={openLinkInput} />
      <div className="flex-1 min-h-0 overflow-y-auto relative" {...{ [EDITOR_CONTAINER_ATTR]: true }}>
        {editor && <ScratchBubbleToolbar editor={editor} />}
        <EditorContent editor={editor} />
        {editor && <TableToolbar editor={editor} />}
        {linkInput && editor && (
          <FloatingLinkInput
            editor={editor}
            position={linkInput}
            existingUrl={linkInput.existingUrl}
            onClose={() => setLinkInput(null)}
          />
        )}
      </div>
    </div>
  )
}
