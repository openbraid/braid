import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── App directory migration ─────────────────────────────────────────────────
//
// These tests run against a REAL temp directory. The bug this code exists to
// prevent was pure filesystem semantics: a whole-directory `renameSync` is a
// permanent no-op once the destination exists, and `scripts/setup-extension.sh`
// pre-creates ~/.braid/vscode-extensions on every `npm run dev`. A mocked fs
// would have accepted that implementation, so nothing here is mocked except
// homedir — which MUST be mocked so no test can ever touch the developer's
// real ~/.braid or ~/.tracigo.

const home = vi.hoisted(() => ({ path: '/home-not-set' }))

// The module imports from bare 'os'; both specifiers are mocked so neither
// import style can escape to the real home directory.
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>()
  return { ...actual, homedir: () => home.path }
})
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => home.path }
})

let tmpRoot: string
let legacyDir: string
let currentDir: string

/**
 * Imports a fresh copy of the module. `ensureAppDir` memoises its result in
 * module scope, so a new module instance is the only way to simulate a
 * subsequent app launch.
 */
async function freshEnsureAppDir(): Promise<() => string> {
  vi.resetModules()
  const mod = await import('./migrate-app-dir')
  return mod.ensureAppDir
}

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'braid-migrate-app-dir-'))
  home.path = join(tmpRoot, 'home')
  mkdirSync(home.path, { recursive: true })
  legacyDir = join(home.path, '.tracigo')
  currentDir = join(home.path, '.braid')

  // Migration logging is expected and noisy; assertions are on the filesystem.
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

/** Seeds a legacy ~/.tracigo resembling a real install. */
function seedLegacyDir(): void {
  mkdirSync(join(legacyDir, 'workspaces', 'proj-1'), { recursive: true })
  writeFileSync(join(legacyDir, 'braid.db'), 'sqlite-database')
  writeFileSync(join(legacyDir, 'config.json'), '{"mode":"local"}')
  writeFileSync(join(legacyDir, 'workspaces', 'proj-1', 'add-auth.code-workspace'), '{}')
}

describe('ensureAppDir', () => {
  it('creates ~/.braid and returns it when there is no legacy directory', async () => {
    const ensureAppDir = await freshEnsureAppDir()

    expect(ensureAppDir()).toBe(currentDir)
    expect(existsSync(currentDir)).toBe(true)
    // Usable: the caller is about to open a database inside it.
    writeFileSync(join(currentDir, 'probe'), 'ok')
    expect(readFileSync(join(currentDir, 'probe'), 'utf8')).toBe('ok')
  })

  it('leaves an existing ~/.braid untouched when there is no legacy directory', async () => {
    mkdirSync(currentDir, { recursive: true })
    writeFileSync(join(currentDir, 'braid.db'), 'live-database')

    const ensureAppDir = await freshEnsureAppDir()
    expect(ensureAppDir()).toBe(currentDir)
    expect(readFileSync(join(currentDir, 'braid.db'), 'utf8')).toBe('live-database')
  })

  it('migrates every entry from ~/.tracigo, including nested directories', async () => {
    seedLegacyDir()

    const ensureAppDir = await freshEnsureAppDir()
    ensureAppDir()

    expect(readFileSync(join(currentDir, 'braid.db'), 'utf8')).toBe('sqlite-database')
    expect(readFileSync(join(currentDir, 'config.json'), 'utf8')).toBe('{"mode":"local"}')
    expect(
      existsSync(join(currentDir, 'workspaces', 'proj-1', 'add-auth.code-workspace'))
    ).toBe(true)
    // Moved, not copied — nothing is left behind to diverge.
    expect(readdirSync(legacyDir)).toEqual([])
  })

  it('still migrates when ~/.braid ALREADY EXISTS and is non-empty', async () => {
    // The regression case: scripts/setup-extension.sh creates
    // ~/.braid/vscode-extensions before Electron starts. A whole-directory
    // rename would refuse from here on and strand the database forever.
    seedLegacyDir()
    mkdirSync(join(currentDir, 'vscode-extensions', 'braid.terminal'), { recursive: true })
    writeFileSync(join(currentDir, 'vscode-extensions', 'braid.terminal', 'package.json'), '{}')

    const ensureAppDir = await freshEnsureAppDir()
    expect(ensureAppDir()).toBe(currentDir)

    expect(readFileSync(join(currentDir, 'braid.db'), 'utf8')).toBe('sqlite-database')
    expect(existsSync(join(currentDir, 'workspaces', 'proj-1'))).toBe(true)
    // The pre-created directory survives alongside the migrated entries.
    expect(
      existsSync(join(currentDir, 'vscode-extensions', 'braid.terminal', 'package.json'))
    ).toBe(true)
  })

  it('never clobbers an entry that already exists at the destination', async () => {
    seedLegacyDir()
    mkdirSync(currentDir, { recursive: true })
    writeFileSync(join(currentDir, 'braid.db'), 'newer-database')

    const ensureAppDir = await freshEnsureAppDir()
    ensureAppDir()

    expect(readFileSync(join(currentDir, 'braid.db'), 'utf8')).toBe('newer-database')
    // The conflicting legacy copy is kept in place rather than deleted, so the
    // user can still recover it by hand.
    expect(readFileSync(join(legacyDir, 'braid.db'), 'utf8')).toBe('sqlite-database')
    // Non-conflicting entries still move.
    expect(readFileSync(join(currentDir, 'config.json'), 'utf8')).toBe('{"mode":"local"}')
  })

  it('resolves a half-finished migration on the next run', async () => {
    // Simulates an interrupted migration: some entries already moved, the rest
    // still sitting in the legacy directory.
    seedLegacyDir()
    mkdirSync(currentDir, { recursive: true })
    writeFileSync(join(currentDir, 'config.json'), '{"mode":"local"}')

    const ensureAppDir = await freshEnsureAppDir()
    ensureAppDir()

    expect(readFileSync(join(currentDir, 'braid.db'), 'utf8')).toBe('sqlite-database')
    expect(existsSync(join(currentDir, 'workspaces', 'proj-1'))).toBe(true)
  })

  it('is idempotent within a process — repeat calls return the same path without re-scanning', async () => {
    seedLegacyDir()

    const ensureAppDir = await freshEnsureAppDir()
    const first = ensureAppDir()
    const second = ensureAppDir()

    expect(second).toBe(first)
    expect(readFileSync(join(currentDir, 'braid.db'), 'utf8')).toBe('sqlite-database')
  })

  it('is idempotent across app launches — a second run is a harmless no-op', async () => {
    seedLegacyDir()

    const firstRun = await freshEnsureAppDir()
    firstRun()

    const secondRun = await freshEnsureAppDir()
    expect(secondRun()).toBe(currentDir)

    expect(readFileSync(join(currentDir, 'braid.db'), 'utf8')).toBe('sqlite-database')
    expect(readFileSync(join(currentDir, 'config.json'), 'utf8')).toBe('{"mode":"local"}')
    expect(
      existsSync(join(currentDir, 'workspaces', 'proj-1', 'add-auth.code-workspace'))
    ).toBe(true)
  })

  it('tolerates an empty legacy directory', async () => {
    mkdirSync(legacyDir, { recursive: true })

    const ensureAppDir = await freshEnsureAppDir()
    expect(ensureAppDir()).toBe(currentDir)
    expect(existsSync(currentDir)).toBe(true)
  })
})
