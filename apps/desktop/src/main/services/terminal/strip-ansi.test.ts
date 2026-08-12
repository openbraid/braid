import { describe, expect, it, vi } from 'vitest'

// index.ts is the orchestration layer: it pulls in Electron, node-pty, the
// Express/WS server and SQLite at module load. None of that is reachable from a
// node test process, so every host-bound edge is mocked. The function under
// test is pure and untouched by these stubs.
vi.mock('electron', () => ({
  BrowserWindow: class {}
}))

vi.mock('./pty-manager', () => ({
  setOnData: vi.fn(),
  setOnExit: vi.fn(),
  spawnTerminal: vi.fn(),
  killTerminal: vi.fn(),
  killAll: vi.fn(),
  writeToTerminal: vi.fn()
}))

vi.mock('./express-server', () => ({
  startExpressServer: vi.fn(),
  stopExpressServer: vi.fn(),
  stopAllExpressServers: vi.fn(),
  broadcastToTerminal: vi.fn(),
  sendToExtension: vi.fn(),
  isExtensionConnected: vi.fn(() => false),
  getExtensionFolders: vi.fn(() => []),
  setApiHandlers: vi.fn(),
  setOnUserInput: vi.fn(),
  setOnWorkspaceFoldersChanged: vi.fn()
}))

vi.mock('../../db/queries/workspace-terminals', () => ({
  createTerminalRecord: vi.fn(),
  getActiveTerminalsByWorkspace: vi.fn(() => []),
  getTerminalById: vi.fn(() => null),
  updateTerminalLabel: vi.fn(),
  updateTerminalPtyId: vi.fn(),
  deleteTerminalRecord: vi.fn()
}))

vi.mock('../../repositories', () => ({
  projectRepo: {
    getAll: vi.fn(async () => []),
    getMonitoredCommands: vi.fn(async () => [])
  }
}))

vi.mock('../../lib/app-state', () => ({
  getAppState: vi.fn(() => ({}))
}))

// shell-integration resolves the app dir at module load, which migrates the
// user's real ~/.tracigo. A test must never touch the host's home directory.
vi.mock('../../lib/migrate-app-dir', () => ({
  ensureAppDir: vi.fn(() => '/tmp/braid-test-app-dir')
}))

const { stripAnsiSequences } = await import('./index')

const ESC = '\x1b'

describe('stripAnsiSequences', () => {
  describe('plain CSI sequences', () => {
    it('strips a reset', () => {
      expect(stripAnsiSequences(`${ESC}[0mhello`)).toBe('hello')
    })

    it('strips multi-parameter SGR', () => {
      expect(stripAnsiSequences(`${ESC}[1;31mred${ESC}[0m`)).toBe('red')
    })

    it('strips parameterless CSI', () => {
      expect(stripAnsiSequences(`${ESC}[Kline`)).toBe('line')
    })

    it('strips cursor movement with a single parameter', () => {
      expect(stripAnsiSequences(`${ESC}[2Aup`)).toBe('up')
    })

    it('strips colon-separated params used by true-colour SGR', () => {
      expect(stripAnsiSequences(`${ESC}[38:2:255:0:0mred`)).toBe('red')
    })
  })

  // The `?` and `<` branches are the regression: without them, terminal replies
  // to agent queries landed in the command buffer and the status pill never
  // updated because command matching saw garbage.
  describe('DEC private sequences (? prefix)', () => {
    it('strips cursor hide', () => {
      expect(stripAnsiSequences(`${ESC}[?25l`)).toBe('')
    })

    it('strips cursor show', () => {
      expect(stripAnsiSequences(`${ESC}[?25h`)).toBe('')
    })

    it('strips bracketed-paste enable', () => {
      expect(stripAnsiSequences(`${ESC}[?2004h`)).toBe('')
    })

    it('strips alternate-screen toggles around text', () => {
      expect(stripAnsiSequences(`${ESC}[?1049htext${ESC}[?1049l`)).toBe('text')
    })

    it('strips a cursor-position report', () => {
      expect(stripAnsiSequences(`${ESC}[?36;3R`)).toBe('')
    })
  })

  describe('SGR mouse sequences (< prefix)', () => {
    it('strips a press report', () => {
      expect(stripAnsiSequences(`${ESC}[<35;10;20M`)).toBe('')
    })

    it('strips a release report', () => {
      expect(stripAnsiSequences(`${ESC}[<0;5;7m`)).toBe('')
    })

    it('strips a mouse report embedded in typed text', () => {
      expect(stripAnsiSequences(`cl${ESC}[<35;20;14Maude`)).toBe('claude')
    })
  })

  describe('other private markers', () => {
    it('strips the > prefix (secondary device attributes)', () => {
      expect(stripAnsiSequences(`${ESC}[>0;10;1c`)).toBe('')
    })

    it('strips the = prefix', () => {
      expect(stripAnsiSequences(`${ESC}[=5n`)).toBe('')
    })
  })

  describe('SS3 and bare escapes', () => {
    it('strips SS3 arrow keys', () => {
      expect(stripAnsiSequences(`${ESC}OA${ESC}OB${ESC}OC${ESC}OD`)).toBe('')
    })

    it('strips an SS3 sequence without eating the following text', () => {
      expect(stripAnsiSequences(`${ESC}OAnpm test`)).toBe('npm test')
    })

    it('strips a bare ESC + letter', () => {
      expect(stripAnsiSequences(`${ESC}Mtext`)).toBe('text')
    })
  })

  describe('ordinary text is left intact', () => {
    it('passes through a plain command', () => {
      expect(stripAnsiSequences('npm run build')).toBe('npm run build')
    })

    it('preserves control characters that are not escapes', () => {
      expect(stripAnsiSequences('line one\r\nline two\t end')).toBe('line one\r\nline two\t end')
    })

    it('preserves square brackets and angle brackets not preceded by ESC', () => {
      expect(stripAnsiSequences('git log --format=[%h] <author>')).toBe(
        'git log --format=[%h] <author>'
      )
    })

    it('preserves unicode', () => {
      expect(stripAnsiSequences('✔ done — 3 файла')).toBe('✔ done — 3 файла')
    })

    it('returns an empty string unchanged', () => {
      expect(stripAnsiSequences('')).toBe('')
    })
  })

  describe('mixed streams', () => {
    // Machine chatter alone must reduce to nothing: index.ts treats a non-empty
    // result as a real human keystroke / meaningful output.
    it('reduces an escape-only stream to empty', () => {
      const escapesOnly = [
        `${ESC}[?25l`,
        `${ESC}[?2004h`,
        `${ESC}[<35;10;20M`,
        `${ESC}[0m`,
        `${ESC}[1;31m`,
        `${ESC}OA`,
        `${ESC}[?36;3R`
      ].join('')
      expect(stripAnsiSequences(escapesOnly)).toBe('')
    })

    it('keeps the content of real coloured output', () => {
      const output = `${ESC}[?25l${ESC}[1;32m✓${ESC}[0m 42 tests passed${ESC}[?25h`
      expect(stripAnsiSequences(output)).toBe('✓ 42 tests passed')
    })

    it('recovers a monitored command typed amid terminal replies', () => {
      const raw = `${ESC}[?2004h${ESC}[<0;1;1Mnpm run dev${ESC}[?2004l`
      expect(stripAnsiSequences(raw).trim()).toBe('npm run dev')
    })
  })
})
