import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mic, PenLine, Square, X } from 'lucide-react'
import { toast } from 'sonner'
import { useScratchStore } from '../../store/scratch-store'
import { ScratchTabBar } from './ScratchTabBar'
import { ScratchEditor } from './ScratchEditor'
import { ScratchSearch } from './ScratchSearch'
import { ipc } from '../../lib/ipc'

const MIN_WIDTH = 320
const MAX_WIDTH_RATIO = 0.6

export function ScratchPanel() {
  const panelOpen = useScratchStore((s) => s.panelOpen)
  const panelWidth = useScratchStore((s) => s.panelWidth)
  const pages = useScratchStore((s) => s.pages)
  const closePanel = useScratchStore((s) => s.closePanel)
  const setPanelWidth = useScratchStore((s) => s.setPanelWidth)
  const loadPages = useScratchStore((s) => s.loadPages)
  const createPage = useScratchStore((s) => s.createPage)
  const searchOpen = useScratchStore((s) => s.searchOpen)
  const dictationState = useScratchStore((s) => s.dictationState)
  const setDictationState = useScratchStore((s) => s.setDictationState)

  const panelRef = useRef<HTMLDivElement>(null)
  const hasLoadedRef = useRef(false)

  // Slide animation state
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)

  // Drag state
  const isDraggingRef = useRef(false)
  const latestXRef = useRef(0)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)
  const rafIdRef = useRef(0)
  const [isDragging, setIsDragging] = useState(false)

  // Mount/unmount with slide animation
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    if (panelOpen) {
      setMounted(true)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true))
      })
    } else {
      setVisible(false)
      timer = setTimeout(() => setMounted(false), 200)
    }
    return () => { if (timer) clearTimeout(timer) }
  }, [panelOpen])

  // Load pages on first open
  useEffect(() => {
    if (panelOpen && !hasLoadedRef.current) {
      hasLoadedRef.current = true
      loadPages()
    }
  }, [panelOpen, loadPages])

  const dictationVolume = useScratchStore((s) => s.dictationVolume)
  const dictationStatus = useScratchStore((s) => s.dictationStatus)

  async function toggleDictation() {
    if (dictationState === 'recording') {
      // Normal stop — transition to transcribing, result will arrive via push
      setDictationState('transcribing')
      await ipc.scratch.dictationStop(false)
    } else if (dictationState === 'idle') {
      const result = await ipc.scratch.dictationStart()
      if (result.success) {
        setDictationState('recording')
      } else {
        toast(result.error ?? 'Could not start dictation')
      }
    }
    // If transcribing, ignore — can't toggle while waiting for result
  }

  // Cmd+D to toggle dictation (document-level so it works when editor has focus)
  // Uses a ref to always access the latest toggleDictation
  const toggleDictationRef = useRef(toggleDictation)
  toggleDictationRef.current = toggleDictation

  useEffect(() => {
    if (!panelOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'd' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        toggleDictationRef.current()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [panelOpen])

  // Esc to close (stops dictation first)
  useEffect(() => {
    if (!panelOpen) return
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          sel.removeAllRanges()
          return
        }
        closePanel()
      }
    }
    const el = panelRef.current
    el?.addEventListener('keydown', handleKeyDown)
    return () => el?.removeEventListener('keydown', handleKeyDown)
  }, [panelOpen, closePanel])

  // ─── Smooth resize via pointer events + RAF loop ───────────────────────────

  const applyResize = useCallback(() => {
    if (!isDraggingRef.current || !panelRef.current) return
    const delta = startXRef.current - latestXRef.current
    const maxWidth = window.innerWidth * MAX_WIDTH_RATIO
    const newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, startWidthRef.current + delta))
    panelRef.current.style.width = `${newWidth}px`
    rafIdRef.current = requestAnimationFrame(applyResize)
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)

    isDraggingRef.current = true
    startXRef.current = e.clientX
    latestXRef.current = e.clientX
    startWidthRef.current = panelRef.current?.getBoundingClientRect().width ?? panelWidth

    setIsDragging(true)
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    if (panelRef.current) panelRef.current.style.willChange = 'width'

    rafIdRef.current = requestAnimationFrame(applyResize)
  }, [panelWidth, applyResize])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDraggingRef.current) return
    latestXRef.current = e.clientX
  }, [])

  // Shared cleanup — called from pointerUp, lostPointerCapture, pointerCancel
  const cleanupDrag = useCallback(() => {
    if (!isDraggingRef.current && !document.body.style.cursor) return
    isDraggingRef.current = false
    cancelAnimationFrame(rafIdRef.current)
    setIsDragging(false)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    if (panelRef.current) panelRef.current.style.willChange = ''
    const finalWidth = panelRef.current?.getBoundingClientRect().width ?? panelWidth
    setPanelWidth(finalWidth)
  }, [panelWidth, setPanelWidth])

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
    cleanupDrag()
  }, [cleanupDrag])

  const onLostPointerCapture = useCallback(() => {
    cleanupDrag()
  }, [cleanupDrag])

  const onPointerCancel = useCallback(() => {
    cleanupDrag()
  }, [cleanupDrag])

  useEffect(() => {
    return () => { cancelAnimationFrame(rafIdRef.current); cleanupDrag() }
  }, [])

  const openPageIds = useScratchStore((s) => s.openPageIds)
  const hasOpenTabs = openPageIds.length > 0
  const hasPages = pages.length > 0

  if (!mounted) return null

  return (
    <>
      {/* Full-viewport overlay during drag — prevents webview iframes from stealing events */}
      {isDragging && (
        <div className="fixed inset-0 z-[45]" style={{ cursor: 'col-resize' }} onPointerUp={cleanupDrag} />
      )}

      <div
        ref={panelRef}
        className="fixed top-[38px] right-0 bottom-0 z-40 flex flex-col bg-surface border-l border-border"
        style={{
          width: panelWidth,
          boxShadow: visible ? '-8px 0 30px rgba(0,0,0,0.12)' : 'none',
          transform: visible ? 'none' : 'translateX(100%)',
          transition: isDragging ? 'none' : 'transform 200ms ease-out, box-shadow 200ms ease-out'
        }}
        tabIndex={-1}
      >
        {/* Resize handle — 24px grab zone, 3px visible line */}
        <div
          className="absolute top-0 bottom-0 z-10 group"
          style={{ left: -12, width: 24, cursor: 'col-resize', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onLostPointerCapture={onLostPointerCapture}
        >
          <div className="absolute left-1/2 top-0 bottom-0 w-[3px] -translate-x-1/2 rounded-full bg-transparent group-hover:bg-brand/40 group-active:bg-brand/60 transition-colors" />
        </div>

        {/* Header */}
        <div className="flex items-center h-[38px] pl-4 pr-2 shrink-0 border-b border-border-subtle gap-1">
          <span className="text-[13px] font-semibold text-fg">Scratch</span>
          <div className="flex-1" />

          {/* Dictation indicator — expands when recording or transcribing */}
          {dictationState !== 'idle' && (
            <div className="flex items-center gap-2 px-2.5 h-7 rounded-md bg-surface-hover/50 mr-1">
              {dictationState === 'recording' ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <span className="text-[11px] text-fg-secondary">
                    {dictationStatus && dictationVolume.length === 0 ? dictationStatus : 'Listening'}
                  </span>
                  {!(dictationStatus && dictationVolume.length === 0) && (
                    <span className="flex items-end gap-[1.5px] h-3">
                      {(dictationVolume.length > 0 ? dictationVolume.slice(0, 5) : [0, 0, 0, 0, 0]).map((level, i) => (
                        <span
                          key={i}
                          className="w-[2px] rounded-full bg-fg-tertiary/60 transition-all duration-75"
                          style={{ height: `${Math.max(2, Math.min(12, level * 12))}px` }}
                        />
                      ))}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <Loader2 size={11} className="text-fg-tertiary animate-spin shrink-0" />
                  <span className="text-[11px] text-fg-tertiary">Transcribing</span>
                </>
              )}
            </div>
          )}

          {/* Mic / Stop button */}
          {dictationState === 'recording' ? (
            <button
              onClick={toggleDictation}
              className="flex items-center justify-center w-7 h-7 rounded text-fg hover:bg-surface-hover transition-colors"
              title="Stop dictation (Cmd+D)"
            >
              <Square size={10} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={toggleDictation}
              disabled={dictationState === 'transcribing'}
              className={[
                'flex items-center justify-center w-7 h-7 rounded transition-colors',
                dictationState === 'transcribing'
                  ? 'text-fg-tertiary opacity-40 cursor-not-allowed'
                  : 'text-fg-tertiary hover:text-fg-secondary hover:bg-surface-hover'
              ].join(' ')}
              title="Start dictation (Cmd+D)"
            >
              <Mic size={14} />
            </button>
          )}

          <button
            onClick={closePanel}
            className="flex items-center justify-center w-7 h-7 rounded text-fg-tertiary hover:text-fg-secondary hover:bg-surface-hover transition-colors"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>

        {hasPages ? (
          <>
            {/* Tab bar or search */}
            {searchOpen ? <ScratchSearch /> : <ScratchTabBar />}

            {/* Editor or "no open tabs" hint */}
            {hasOpenTabs ? (
              <div className="flex-1 min-h-0">
                <ScratchEditor />
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center px-6">
                <p className="text-[13px] text-fg-tertiary text-center">
                  Open a page from the <span className="font-medium text-fg-secondary">+</span> menu, or create a new one.
                </p>
              </div>
            )}
          </>
        ) : (
          /* Empty state — no pages exist at all */
          <div className="flex-1 flex items-center justify-center px-8">
            <div className="max-w-[320px] flex flex-col items-center text-center select-text">
              <PenLine size={28} className="text-fg-tertiary mb-5" />
              <h2 className="text-[15px] font-semibold text-fg mb-2">Scratch</h2>
              <p className="text-[13px] text-fg-secondary leading-relaxed mb-6">
                The space between thinking and doing.
              </p>
              <p className="text-[12px] text-fg-tertiary leading-relaxed mb-8">
                While your agents write code, your mind is already three steps ahead — the next prompt, a better approach, that thing you don&rsquo;t want to forget. Scratch catches all of it.
              </p>

              <div className="w-full flex flex-col gap-4 mb-8 text-left">
                <div>
                  <p className="text-[12px] font-medium text-fg mb-0.5">Write anything</p>
                  <p className="text-[11px] text-fg-tertiary leading-relaxed">
                    No structure required. Markdown, code, raw thoughts — just start typing.
                  </p>
                </div>
                <div>
                  <p className="text-[12px] font-medium text-fg mb-0.5">Act on your words</p>
                  <p className="text-[11px] text-fg-tertiary leading-relaxed">
                    Select any text to send it to a terminal, launch an agent, or spin up a new workspace.
                  </p>
                </div>
                <div>
                  <p className="text-[12px] font-medium text-fg mb-0.5">Pages, not files</p>
                  <p className="text-[11px] text-fg-tertiary leading-relaxed">
                    Create pages for different threads of thinking. They stay here across sessions, always one shortcut (<kbd className="px-1 py-0.5 rounded bg-surface-hover text-fg-secondary text-[10px] font-mono">Ctrl+Shift+S</kbd>) away.
                  </p>
                </div>
              </div>

              <button
                onClick={() => createPage()}
                className="px-5 py-2 rounded-lg bg-brand text-white text-[13px] font-medium hover:bg-brand-hover transition-colors"
              >
                + Start writing
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
