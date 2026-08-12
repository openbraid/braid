import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { terminalTheme, getTerminalTheme } from './theme'
import { WsTransport } from './ws-transport'
import { DictationBar } from './dictation/DictationBar'
import { SearchBar } from './SearchBar'
import type { ThemeKind } from '../shared/theme'

type Props = {
  terminalId: string
}

export function Terminal({ terminalId }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const transportRef = useRef<WsTransport | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [dictationOpen, setDictationOpen] = useState(false)
  const [isInteractiveAgent, setIsInteractiveAgent] = useState(false)
  const isInteractiveAgentRef = useRef(false)
  const [themeKind, setThemeKind] = useState<ThemeKind>('dark')

  // Callback: send dictated text to PTY as keystrokes
  const handleDictationDone = useCallback((text: string) => {
    transportRef.current?.sendInput(text)
    setDictationOpen(false)
    termRef.current?.focus()
  }, [])

  const handleDictationClose = useCallback(() => {
    setDictationOpen(false)
    termRef.current?.focus()
  }, [])

  const handleStartRecording = useCallback(() => {
    transportRef.current?.sendDictationStart()
  }, [])

  const handleStopRecording = useCallback(() => {
    transportRef.current?.sendDictationStop()
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const t0 = performance.now()
    console.log(`[Terminal] mount, terminalId=${terminalId}`)

    // Create xterm.js instance
    const term = new XTerm({
      theme: terminalTheme,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(new WebLinksAddon((_event, uri) => {
      fetch('/api/open-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: uri })
      }).catch(() => {})
    }))
    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon
    const unicode11Addon = new Unicode11Addon()
    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'

    term.open(container)

    // Try WebGL rendering, fall back to canvas
    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon.dispose()
      })
      term.loadAddon(webglAddon)
    } catch {
      console.log('[Terminal] WebGL not available, using canvas renderer')
    }

    fitAddon.fit()
    console.log(`[Terminal] xterm init + fit took ${(performance.now() - t0).toFixed(0)}ms`)

    // Write welcome MOTD directly to xterm display (not to PTY stdin).
    // This is display-only — the shell never sees it.
    const isMac = navigator.platform.includes('Mac')
    const dictateKey = isMac ? 'Cmd+D' : 'Ctrl+Shift+D'
    term.write([
      '',
      '  \x1b[1m\x1b[38;2;200;103;74m\u2B21\x1b[0m \x1b[1mBraid Terminal\x1b[0m',
      '  \x1b[2m\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\x1b[0m',
      `  \x1b[2m${isMac ? 'Cmd+T' : 'Ctrl+T'}\x1b[0m        \x1b[2mNew terminal\x1b[0m`,
      '  \x1b[2mF2\x1b[0m           \x1b[2mRename\x1b[0m',
      `  \x1b[2m${dictateKey}\x1b[0m      \x1b[2mVoice dictation (when agent running)\x1b[0m`,
      '  \x1b[2mCmd+Shift+P\x1b[0m  \x1b[2mCommand palette\x1b[0m',
      '',
      ''
    ].join('\r\n'))

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Connect WebSocket transport
    const transport = new WsTransport(terminalId)
    transportRef.current = transport

    // Server → xterm.js
    let firstDataReceived = false
    transport.onMessage((msg) => {
      // Apply persisted theme on initial connection — before any content renders
      if (msg.type === 'REGISTERED') {
        console.log(`[Terminal] REGISTERED received at ${(performance.now() - t0).toFixed(0)}ms`)
        const theme = getTerminalTheme(msg.themeKind)
        term.options.theme = theme
        container.style.backgroundColor = theme.background ?? '#141414'
        setThemeKind(msg.themeKind)
      }

      if (msg.type === 'TERMINAL.DATA' && msg.terminalId === terminalId) {
        if (!firstDataReceived) {
          firstDataReceived = true
          console.log(`[Terminal] first PTY data at ${(performance.now() - t0).toFixed(0)}ms`)
        }
        term.write(msg.data)
      }

      if (msg.type === 'TERMINAL.EXIT' && msg.terminalId === terminalId) {
        const code = msg.exitCode
        term.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`)
        // TODO: Auto-close panel on shell exit (user types 'exit', shell crash, etc.)
        // The postMessage chain (iframe → webview HTML → extension) doesn't work here —
        // likely a VS Code webview/iframe lifecycle issue during PTY teardown.
        // Fix: have the extension connect directly to the Express WebSocket and listen
        // for TERMINAL.EXIT events, bypassing the iframe entirely.
      }

      // Agent status updates — gate dictation availability
      if (msg.type === 'TERMINAL.AGENT_STATUS' && msg.terminalId === terminalId) {
        setIsInteractiveAgent(msg.isInteractiveAgent)
        isInteractiveAgentRef.current = msg.isInteractiveAgent
      }

      // Dictation messages — forward to DictationBar via window message
      if (msg.type === 'DICTATION.VOLUME') {
        window.postMessage({ type: 'dictation-volume', levels: msg.levels }, '*')
      }
      if (msg.type === 'DICTATION.RESULT') {
        window.postMessage({ type: 'dictation-result', text: msg.text }, '*')
      }
      if (msg.type === 'DICTATION.ERROR') {
        window.postMessage({ type: 'dictation-error', error: msg.error }, '*')
      }
      if (msg.type === 'DICTATION.STATUS') {
        window.postMessage({ type: 'dictation-status', message: msg.message }, '*')
      }

      // Theme changes — update xterm colors and dictation bar dynamically
      if (msg.type === 'THEME.CHANGED') {
        const newTheme = getTerminalTheme(msg.kind)
        term.options.theme = newTheme
        // Update container background to match (xterm doesn't repaint padding area)
        container.style.backgroundColor = newTheme.background ?? '#141414'
        setThemeKind(msg.kind)
      }
    })

    // ── Keyboard shortcut routing ──────────────────────────────────────────
    const extensionShortcuts: Array<{
      test: (e: KeyboardEvent) => boolean
      command: string
    }> = [
      { test: (e) => e.metaKey && e.key === 't', command: 'braid.newTerminal' },
      { test: (e) => e.key === 'F2', command: 'braid.renameTerminal' }
    ]

    const suppressedBrowserShortcuts = [
      (e: KeyboardEvent): boolean => e.metaKey && e.key === 'n',
      (e: KeyboardEvent): boolean => e.metaKey && e.shiftKey && e.key === 'N'
    ]

    const forwardToVsCode = (event: KeyboardEvent): void => {
      window.parent.postMessage({
        type: 'forward-keydown',
        key: event.key,
        code: event.code,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey
      }, '*')
    }

    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      // ── Keys xterm should handle natively ───────────────────────────────
      // Shell signals: Ctrl+single letter (Ctrl+C, Ctrl+Z, etc.)
      if (event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.key.length === 1) {
        return true
      }
      // Clipboard: Cmd+C, Cmd+V
      if (event.metaKey && (event.key === 'c' || event.key === 'v')) {
        return true
      }
      // Select all: Cmd+A — xterm manages its own selection
      if (event.metaKey && event.key === 'a') {
        return true
      }

      // ── Escape: clear selection if active, otherwise send to PTY ───────
      if (event.key === 'Escape') {
        if (term.hasSelection()) {
          term.clearSelection()
          return false
        }
        return true
      }

      // ── App-level shortcuts (don't reach xterm or VS Code) ─────────────
      // Dictation toggle: Cmd+D (mac) or Ctrl+Shift+D (win/linux)
      const isDictateKey = isMac
        ? event.metaKey && event.key === 'd'
        : event.ctrlKey && event.shiftKey && event.key === 'D'
      if (isDictateKey) {
        event.preventDefault()
        setDictationOpen((prev) => {
          if (!prev && !isInteractiveAgentRef.current) {
            console.log('[Terminal] Dictation requires an interactive agent to be running')
            return false
          }
          return !prev
        })
        return false
      }
      // Clear screen + scrollback: Cmd+K
      if (event.metaKey && event.key === 'k') {
        event.preventDefault()
        term.clear()
        return false
      }

      // Search: Cmd+F / Ctrl+F
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault()
        setSearchOpen(true)
        return false
      }

      // ── Extension commands (forwarded to VS Code extension host) ───────
      for (const shortcut of extensionShortcuts) {
        if (shortcut.test(event)) {
          event.preventDefault()
          window.parent.postMessage({
            type: 'extension-command',
            command: shortcut.command
          }, '*')
          return false
        }
      }

      // ── Suppress browser defaults (Cmd+N, Cmd+Shift+N) ────────────────
      for (const test of suppressedBrowserShortcuts) {
        if (test(event)) {
          event.preventDefault()
          return false
        }
      }

      // ── Forward remaining Cmd/Ctrl combos and function keys to VS Code ─
      // The iframe traps all keyboard events. Returning false from xterm only
      // prevents xterm from consuming it — we must also re-dispatch via
      // postMessage so the webview wrapper can fire a native KeyboardEvent
      // that VS Code sees.
      if (event.metaKey || event.ctrlKey) {
        forwardToVsCode(event)
        return false
      }
      if (event.key.startsWith('F') && event.key.length <= 3 && !isNaN(Number(event.key.slice(1)))) {
        forwardToVsCode(event)
        return false
      }

      return true
    })

    // xterm.js → server (keystrokes)
    term.onData((data) => {
      transport.sendInput(data)
    })

    transport.connect()

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      transport.sendResize(term.cols, term.rows)
    })
    resizeObserver.observe(container)

    // Also send initial size after a small delay (let fit settle)
    const sizeTimer = setTimeout(() => {
      fitAddon.fit()
      transport.sendResize(term.cols, term.rows)
    }, 200)

    // Focus handling — listen for messages from parent (WebviewPanel wrapper)
    function handleMessage(event: MessageEvent): void {
      if (event.data?.type === 'focus-terminal') {
        term.focus()
      }
    }
    window.addEventListener('message', handleMessage)

    // Auto-focus on load
    term.focus()

    return (): void => {
      clearTimeout(sizeTimer)
      resizeObserver.disconnect()
      window.removeEventListener('message', handleMessage)
      transport.disconnect()
      term.dispose()
    }
  }, [terminalId])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden'
        }}
      />
      {searchOpen && searchAddonRef.current && (
        <SearchBar
          searchAddon={searchAddonRef.current}
          themeKind={themeKind}
          onClose={() => { setSearchOpen(false); termRef.current?.focus() }}
        />
      )}
      <DictationBar
        isOpen={dictationOpen}
        themeKind={themeKind}
        onClose={handleDictationClose}
        onDone={handleDictationDone}
        onStartRecording={handleStartRecording}
        onStopRecording={handleStopRecording}
      />
    </div>
  )
}
