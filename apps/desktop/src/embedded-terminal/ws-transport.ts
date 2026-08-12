// WebSocket transport for the embedded terminal SPA.
// Connects to the Express server's /ws endpoint, handles reconnection,
// and provides typed send/listen methods.

type ServerMessage =
  | { type: 'REGISTERED'; themeKind: 'dark' | 'light' }
  | { type: 'TERMINAL.DATA'; terminalId: string; data: string }
  | { type: 'TERMINAL.EXIT'; terminalId: string; exitCode: number }
  | { type: 'TERMINAL.AGENT_STATUS'; terminalId: string; isInteractiveAgent: boolean; command: string | null }
  | { type: 'DICTATION.VOLUME'; levels: number[] }
  | { type: 'DICTATION.RESULT'; text: string }
  | { type: 'DICTATION.ERROR'; error: string }
  | { type: 'THEME.CHANGED'; kind: 'dark' | 'light' }

type Listener = (msg: ServerMessage) => void

export class WsTransport {
  private ws: WebSocket | null = null
  private listeners: Set<Listener> = new Set()
  private terminalId: string
  private url: string
  private shouldReconnect = true
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectAttempts = 0
  private readonly MAX_RECONNECT_ATTEMPTS = 20
  private readonly RECONNECT_DELAY_MS = 1500

  constructor(terminalId: string) {
    this.terminalId = terminalId
    // Connect to same host that served this page
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    this.url = `${protocol}//${location.host}/ws`
  }

  connect(): void {
    const connectStart = performance.now()
    try {
      this.ws = new WebSocket(this.url)
    } catch (err) {
      console.error('[WsTransport] Failed to create WebSocket:', err)
      this.scheduleReconnect()
      return
    }

    this.ws.onopen = (): void => {
      console.log(`[WsTransport] Connected in ${(performance.now() - connectStart).toFixed(0)}ms`)
      this.reconnectAttempts = 0

      // Register this terminal
      this.sendRaw({
        type: 'REGISTER',
        clientType: 'terminal',
        terminalId: this.terminalId
      })
    }

    this.ws.onmessage = (event): void => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage
        for (const listener of this.listeners) {
          listener(msg)
        }
      } catch {
        // malformed message
      }
    }

    this.ws.onclose = (): void => {
      console.log('[WsTransport] Disconnected')
      this.ws = null
      if (this.shouldReconnect) {
        this.scheduleReconnect()
      }
    }

    this.ws.onerror = (): void => {
      // onclose will fire after this
    }
  }

  sendInput(data: string): void {
    this.sendRaw({
      type: 'TERMINAL.INPUT',
      terminalId: this.terminalId,
      data
    })
  }

  sendResize(cols: number, rows: number): void {
    this.sendRaw({
      type: 'TERMINAL.RESIZE',
      terminalId: this.terminalId,
      cols,
      rows
    })
  }

  sendDictationStart(): void {
    this.sendRaw({ type: 'DICTATION.START' })
  }

  sendDictationStop(): void {
    this.sendRaw({ type: 'DICTATION.STOP' })
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  disconnect(): void {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.ws?.close()
    this.ws = null
  }

  private sendRaw(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('[WsTransport] Max reconnect attempts reached')
      return
    }

    this.reconnectAttempts++
    console.log(`[WsTransport] Reconnecting (${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS})...`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.RECONNECT_DELAY_MS)
  }
}
