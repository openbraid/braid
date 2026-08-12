import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// ─── App mode ────────────────────────────────────────────────────────────────
//
// app-mode resolves its config path through migrate-app-dir, which joins
// `homedir()`. Left unmocked these tests would create and mutate the developer's
// real ~/.braid/config.json, so `os.homedir` is redirected at the module level to
// a throwaway directory that is rebuilt for every test.
//
// The mock holder must be created with `vi.hoisted` because `vi.mock` factories
// are hoisted above ordinary `let` declarations.
const home = vi.hoisted(() => ({ path: '' }))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => home.path }
})

type AppModeModule = typeof import('./app-mode')

/** Both app-mode and migrate-app-dir cache at module scope — reset them together. */
async function freshModule(): Promise<AppModeModule> {
  vi.resetModules()
  return import('./app-mode')
}

function configPath(): string {
  return join(home.path, '.braid', 'config.json')
}

function writeConfig(contents: string): void {
  mkdirSync(join(home.path, '.braid'), { recursive: true })
  writeFileSync(configPath(), contents)
}

function readConfig(): unknown {
  return JSON.parse(readFileSync(configPath(), 'utf-8'))
}

describe('app-mode', () => {
  beforeEach(() => {
    home.path = mkdtempSync(join(tmpdir(), 'braid-app-mode-'))
  })

  afterEach(() => {
    rmSync(home.path, { recursive: true, force: true })
  })

  describe('getConfig', () => {
    it('returns local defaults and seeds config.json when the file is missing', async () => {
      const { getConfig, AppMode } = await freshModule()

      const config = getConfig()

      expect(config).toEqual({
        mode: AppMode.Local,
        serverUrl: null,
        serverToken: null,
        telemetryEnabled: false
      })
      // A fresh install must leave a readable config behind, not just an
      // in-memory default, so the user has something to edit.
      expect(readConfig()).toEqual(config)
    })

    it('falls back to local defaults when config.json is malformed JSON', async () => {
      writeConfig('{ this is not json')
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { getConfig, AppMode } = await freshModule()

      const config = getConfig()

      expect(config.mode).toBe(AppMode.Local)
      expect(config.serverUrl).toBeNull()
      expect(warn).toHaveBeenCalled()
    })

    it('leaves a malformed config.json on disk rather than overwriting it', async () => {
      // Silently clobbering an unparseable file would destroy a server URL the
      // user only mistyped.
      writeConfig('{ this is not json')
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { getConfig } = await freshModule()

      getConfig()

      expect(readFileSync(configPath(), 'utf-8')).toBe('{ this is not json')
    })

    it('fills in defaults for keys the config file omits', async () => {
      writeConfig(JSON.stringify({ telemetryEnabled: true }))
      const { getConfig, AppMode } = await freshModule()

      const config = getConfig()

      expect(config).toEqual({
        mode: AppMode.Local,
        serverUrl: null,
        serverToken: null,
        telemetryEnabled: true
      })
    })

    it('caches the first read', async () => {
      const { getConfig } = await freshModule()

      const first = getConfig()
      // Editing the file behind the app's back must not change the live config:
      // repository bindings are resolved at module load, so a mode switch needs
      // a restart.
      writeConfig(JSON.stringify({ mode: 'team', serverUrl: 'http://10.0.0.4:3003' }))

      expect(getConfig()).toBe(first)
      expect(getConfig().mode).toBe('local')
    })
  })

  describe('mode resolution', () => {
    it('resolves team mode when mode is team and a server URL is present', async () => {
      writeConfig(
        JSON.stringify({ mode: 'team', serverUrl: 'http://10.0.0.4:3003', serverToken: 'tok' })
      )
      const { getConfig, isLocalMode, getServerUrl, AppMode } = await freshModule()

      expect(getConfig().mode).toBe(AppMode.Team)
      expect(isLocalMode()).toBe(false)
      expect(getServerUrl()).toBe('http://10.0.0.4:3003')
    })

    it('downgrades to local when mode is team but no server URL is set', async () => {
      // A team config with nowhere to connect cannot load a single project.
      writeConfig(JSON.stringify({ mode: 'team', serverUrl: null, serverToken: 'tok' }))
      const { getConfig, isLocalMode, AppMode } = await freshModule()

      expect(getConfig().mode).toBe(AppMode.Local)
      expect(isLocalMode()).toBe(true)
    })

    it('downgrades to local when the server URL is an empty string', async () => {
      writeConfig(JSON.stringify({ mode: 'team', serverUrl: '' }))
      const { getConfig, AppMode } = await freshModule()

      expect(getConfig().mode).toBe(AppMode.Local)
    })

    it('stays local when a server URL is set but mode is not team', async () => {
      // NOTE: contrary to "team mode is inferred from a server URL", the module
      // requires an explicit `mode: 'team'`. A serverUrl alone is not enough —
      // the URL is a necessary but not sufficient condition.
      writeConfig(JSON.stringify({ serverUrl: 'http://10.0.0.4:3003', serverToken: 'tok' }))
      const { getConfig, isLocalMode, getServerUrl, AppMode } = await freshModule()

      expect(getConfig().mode).toBe(AppMode.Local)
      expect(isLocalMode()).toBe(true)
      // The URL itself is still preserved and readable.
      expect(getServerUrl()).toBe('http://10.0.0.4:3003')
    })

    it('rejects an unrecognised mode value in favour of local', async () => {
      writeConfig(JSON.stringify({ mode: 'enterprise', serverUrl: 'http://10.0.0.4:3003' }))
      const { getConfig, AppMode } = await freshModule()

      expect(getConfig().mode).toBe(AppMode.Local)
    })
  })

  describe('setConfig', () => {
    it('merges the patch, persists it, and updates the cache', async () => {
      const { getConfig, setConfig } = await freshModule()

      const next = setConfig({ serverUrl: 'http://10.0.0.4:3003', mode: 'team' })

      expect(next).toEqual({
        mode: 'team',
        serverUrl: 'http://10.0.0.4:3003',
        serverToken: null,
        telemetryEnabled: false
      })
      expect(readConfig()).toEqual(next)
      expect(getConfig()).toEqual(next)
    })

    it('leaves untouched keys alone', async () => {
      const { setConfig } = await freshModule()

      setConfig({ serverToken: 'tok' })
      const after = setConfig({ telemetryEnabled: true })

      expect(after.serverToken).toBe('tok')
      expect(after.telemetryEnabled).toBe(true)
    })

    it('writes the config file when none existed yet', async () => {
      const { setConfig } = await freshModule()

      setConfig({ telemetryEnabled: true })

      expect(readConfig()).toMatchObject({ telemetryEnabled: true })
    })

    it('does not re-validate mode on write', async () => {
      // NOTE: the team/serverUrl guard lives in getConfig only. setConfig will
      // happily persist `mode: 'team'` with no server URL; the value is corrected
      // on the next process start rather than at write time.
      const { setConfig } = await freshModule()

      const next = setConfig({ mode: 'team' })

      expect(next.mode).toBe('team')
      expect(next.serverUrl).toBeNull()

      const reread = await freshModule()
      expect(reread.getConfig().mode).toBe('local')
    })
  })
})
