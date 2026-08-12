// Inline dictation bar for voice-to-text input in terminal.
// Appears as a compact overlay at the bottom of the terminal viewport.
//
// All audio capture happens in the Electron main process (hidden BrowserWindow).
// This component only sends WS commands and displays results.
//
// States: recording → transcribing → editing → (done | more recording)
//
// Keyboard:
//   Cmd+D (mac) / Ctrl+Shift+D (win)  — toggle recording (global)
//   Enter                               — type text into terminal, close bar (textarea focused only)
//   Escape                              — cancel and close (global)

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { Waveform } from './Waveform'
import { getDictationColors } from './theme'
import type { ThemeKind, DictationThemeTokens } from '../../shared/theme'

type DictationState = 'recording' | 'transcribing' | 'editing'

// 4 lines * 12px fontSize * 1.3 lineHeight + padding
const TEXTAREA_MAX_HEIGHT_COMPACT = 70
const TEXTAREA_MAX_HEIGHT_EXPANDED = '60vh'

type Props = {
  isOpen: boolean
  themeKind: ThemeKind
  onClose: () => void
  onDone: (text: string) => void
  onStartRecording: () => void
  onStopRecording: () => void
}

export function DictationBar({
  isOpen,
  themeKind,
  onClose,
  onDone,
  onStartRecording,
  onStopRecording
}: Props): React.ReactElement | null {
  const c = useMemo(() => getDictationColors(themeKind), [themeKind])
  const [state, setState] = useState<DictationState>('recording')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [volumeLevels, setVolumeLevels] = useState<number[]>([])
  const [isExpanded, setIsExpanded] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Start recording when bar opens
  useEffect(() => {
    if (!isOpen) return
    setState('recording')
    setText('')
    setError(null)
    setStatusMessage(null)
    setVolumeLevels([])
    setIsExpanded(false)
    onStartRecording()
  }, [isOpen, onStartRecording])

  // Focus textarea when entering editing state
  useEffect(() => {
    if (state === 'editing' && textareaRef.current) {
      textareaRef.current.focus()
      const len = textareaRef.current.value.length
      textareaRef.current.setSelectionRange(len, len)
    }
  }, [state])

  // Auto-resize textarea to fit content (up to max height), unless expanded
  useEffect(() => {
    const el = textareaRef.current
    if (!el || state !== 'editing' || isExpanded) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_COMPACT)}px`
  }, [text, state, isExpanded])

  // Listen for messages from Terminal.tsx (volume data, results, errors)
  useEffect(() => {
    const handler = (event: MessageEvent): void => {
      const data = event.data
      if (!data) return

      if (data.type === 'dictation-volume') {
        setStatusMessage(null)
        setVolumeLevels(data.levels as number[])
      }
      if (data.type === 'dictation-status') {
        setStatusMessage(data.message as string)
      }
      if (data.type === 'dictation-result') {
        const newText = data.text as string
        // Add space before appending to existing text
        setText((prev) => (prev ? `${prev} ${newText}` : newText))
        setState('editing')
      }
      if (data.type === 'dictation-error') {
        const errorMsg = data.error as string
        setError(errorMsg)
        setState('editing')
        // "Setting up" errors auto-dismiss — model is still downloading
        if (errorMsg.includes('try again')) {
          setTimeout(() => {
            window.postMessage({ type: 'dictation-auto-dismiss' }, '*')
          }, 3000)
        }
      }
      if (data.type === 'dictation-auto-dismiss') {
        setError(null)
        onCloseRef.current()
      }
    }

    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const stopAndTranscribe = useCallback(() => {
    setState('transcribing')
    setVolumeLevels([])
    onStopRecording()
  }, [onStopRecording])

  const startMoreRecording = useCallback(() => {
    setState('recording')
    setError(null)
    setVolumeLevels([])
    onStartRecording()
  }, [onStartRecording])

  const handleDone = useCallback(() => {
    const trimmed = text.trim()
    if (trimmed) {
      // Add a leading space so dictated text doesn't collide with
      // whatever the user already typed in the terminal prompt
      onDone(` ${trimmed}`)
    }
    onClose()
  }, [text, onDone, onClose])

  const handleCancel = useCallback(() => {
    if (state === 'recording') {
      onStopRecording()
    }
    onClose()
  }, [state, onStopRecording, onClose])

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev)
  }, [])

  // Keyboard shortcuts when bar is open
  useEffect(() => {
    if (!isOpen) return

    const handler = (event: KeyboardEvent): void => {
      const isMac = navigator.platform.includes('Mac')
      const isDictateKey = isMac
        ? event.metaKey && event.key === 'd'
        : event.ctrlKey && event.shiftKey && event.key === 'D'

      // Cmd+D / Ctrl+Shift+D: toggle recording (global — works regardless of focus)
      if (isDictateKey) {
        event.preventDefault()
        event.stopPropagation()
        if (state === 'recording') {
          stopAndTranscribe()
        } else if (state === 'editing') {
          startMoreRecording()
        }
        return
      }

      // Enter: submit text (only when textarea is focused)
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        state === 'editing' &&
        document.activeElement === textareaRef.current
      ) {
        event.preventDefault()
        event.stopPropagation()
        handleDone()
        return
      }

      // Escape: cancel (global)
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        handleCancel()
      }
    }

    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [isOpen, state, stopAndTranscribe, startMoreRecording, handleDone, handleCancel])

  const styles = useMemo(() => buildStyles(c), [c])

  if (!isOpen) return null

  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')
  const dictateKey = isMac ? 'Cmd+D' : 'Ctrl+Shift+D'

  const textareaStyle: React.CSSProperties = isExpanded
    ? { ...styles.textarea, maxHeight: TEXTAREA_MAX_HEIGHT_EXPANDED, height: TEXTAREA_MAX_HEIGHT_EXPANDED }
    : styles.textarea

  return (
    <div style={styles.overlay}>
      <div style={styles.bar}>
        {/* Header */}
        <div style={styles.header}>
          <span style={styles.headerText}>
            {state === 'recording' && '\u25CF Recording'}
            {state === 'transcribing' && 'Transcribing...'}
            {state === 'editing' && 'Dictation'}
          </span>
          <div style={styles.headerActions}>
            {state === 'editing' && (
              <button
                onClick={toggleExpanded}
                style={styles.expandButton}
                title={isExpanded ? 'Collapse' : 'Expand'}
              >
                {isExpanded ? '\u2199' : '\u2197'}
              </button>
            )}
            <span style={styles.hint}>
              {state === 'recording' && `${dictateKey} stop`}
              {state === 'editing' && `Enter done \u00b7 ${dictateKey} record \u00b7 Esc cancel`}
            </span>
          </div>
        </div>

        {/* Recording: waveform or status message */}
        {state === 'recording' && (
          <div style={styles.content}>
            {statusMessage && volumeLevels.length === 0 ? (
              <span style={styles.hint}>{statusMessage}</span>
            ) : (
              <Waveform levels={volumeLevels} isActive={true} themeKind={themeKind} />
            )}
            <button onClick={stopAndTranscribe} style={styles.secondaryButton}>
              Stop
            </button>
          </div>
        )}

        {/* Transcribing: progress */}
        {state === 'transcribing' && (
          <div style={styles.content}>
            <div style={styles.progressBar}>
              <div style={styles.progressFill} />
            </div>
          </div>
        )}

        {/* Editing: textarea with buttons */}
        {state === 'editing' && (
          <div style={styles.content}>
            {error && <div style={styles.error}>{error}</div>}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Transcription will appear here..."
              style={textareaStyle}
            />
            <div style={styles.buttons}>
              <button onClick={startMoreRecording} style={styles.secondaryButton}>
                + Record
              </button>
              <button
                onClick={handleDone}
                style={{
                  ...styles.primaryButton,
                  opacity: text.trim() ? 1 : 0.5
                }}
                disabled={!text.trim()}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const FONT = 'Menlo, Monaco, "Courier New", monospace'

function buildStyles(c: DictationThemeTokens): Record<string, React.CSSProperties> {
  return {
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    padding: '4px 6px'
  },
  bar: {
    background: c.barBackground,
    border: `1px solid ${c.barBorder}`,
    borderRadius: '6px',
    padding: '6px 10px',
    boxShadow: '0 -2px 12px rgba(0, 0, 0, 0.3)'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px'
  },
  headerText: {
    color: c.headerText,
    fontSize: '11px',
    fontFamily: FONT,
    fontWeight: 500
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  hint: {
    color: c.hintText,
    fontSize: '10px',
    fontFamily: FONT
  },
  expandButton: {
    background: 'transparent',
    border: 'none',
    color: c.hintText,
    fontSize: '14px',
    cursor: 'pointer',
    padding: '0 2px',
    lineHeight: 1
  },
  content: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '4px'
  },
  secondaryButton: {
    alignSelf: 'flex-end',
    background: 'transparent',
    border: `1px solid ${c.buttonBorder}`,
    borderRadius: '3px',
    color: c.buttonText,
    fontSize: '11px',
    fontFamily: FONT,
    padding: '2px 8px',
    cursor: 'pointer'
  },
  progressBar: {
    height: '3px',
    background: c.progressTrack,
    borderRadius: '2px',
    overflow: 'hidden'
  },
  progressFill: {
    height: '100%',
    width: '60%',
    background: c.progressFill,
    borderRadius: '2px',
    animation: 'dictation-progress 1.5s ease-in-out infinite'
  },
  error: {
    color: c.errorText,
    fontSize: '10px',
    fontFamily: FONT
  },
  textarea: {
    background: c.inputBackground,
    border: `1px solid ${c.inputBorder}`,
    borderRadius: '3px',
    color: c.inputText,
    fontSize: '12px',
    fontFamily: FONT,
    lineHeight: '1.3',
    padding: '4px 6px',
    resize: 'none' as const,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box' as const,
    minHeight: '20px',
    maxHeight: `${TEXTAREA_MAX_HEIGHT_COMPACT}px`,
    overflow: 'auto'
  },
  buttons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '6px'
  },
  primaryButton: {
    background: c.primaryButtonBackground,
    border: 'none',
    borderRadius: '3px',
    color: c.primaryButtonText,
    fontSize: '11px',
    fontFamily: FONT,
    padding: '2px 10px',
    cursor: 'pointer',
    fontWeight: 600
  }
}}
