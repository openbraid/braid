// ─── WebSocket protocol (embedded terminal SPA ↔ Express server) ─────────────
// Client = xterm.js SPA running in iframe inside VS Code WebviewPanel
// Server = Express + WS server in Electron main process

// Client → Server
export type WsClientMessage =
  | { type: 'REGISTER'; clientType: 'terminal'; terminalId: string }
  | { type: 'TERMINAL.INPUT'; terminalId: string; data: string }
  | { type: 'TERMINAL.RESIZE'; terminalId: string; cols: number; rows: number }
  | { type: 'DICTATION.START' }
  | { type: 'DICTATION.STOP' }

// Server → Client
export type WsServerMessage =
  | { type: 'REGISTERED'; themeKind: 'dark' | 'light' }
  | { type: 'TERMINAL.DATA'; terminalId: string; data: string }
  | { type: 'TERMINAL.EXIT'; terminalId: string; exitCode: number }
  | { type: 'TERMINAL.AGENT_STATUS'; terminalId: string; isInteractiveAgent: boolean; command: string | null }
  | { type: 'DICTATION.VOLUME'; levels: number[] }
  | { type: 'DICTATION.RESULT'; text: string }
  | { type: 'DICTATION.ERROR'; error: string }
  | { type: 'THEME.CHANGED'; kind: 'dark' | 'light' }

// ─── Control WebSocket protocol (Express server ↔ VS Code extension) ────────
// Bidirectional channel for commands between main process and extension.

// Extension → Server
export type ControlClientMessage =
  | { type: 'CONTROL.REGISTER'; folders: string[] }
  | { type: 'CONTROL.WORKSPACE_READY'; folders: string[] }

// Server → Extension
export type ControlServerMessage =
  | { type: 'CONTROL.CREATE_TERMINAL'; command?: string }

// ─── Internal terminal state ────────────────────────────────────────────────
// Richer than the shared WorkspaceTerminalEntry in ipc-types.ts —
// extra fields are for state machine use only, stripped before pushing to renderer.

export type InternalTerminalStatus = 'running' | 'idle' | 'completed'

export type InternalTerminalEntry = {
  terminalId: string      // runtime PTY ID
  dbRecordId: string      // stable DB row ID (survives respawn)
  workspaceId: string
  label: string
  displayOrder: number
  isActive: boolean
  shellPid: number        // PID of the shell process (for tpgid queries)
  command: string | null   // detected foreground process name
  exitCode: number | null
  status: InternalTerminalStatus
  lastOutputAt: number | null
  completedAt: number | null  // timestamp when command completed
  seenByUser: boolean
}
