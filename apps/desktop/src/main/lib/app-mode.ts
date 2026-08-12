// ─── App mode ────────────────────────────────────────────────────────────────
//
// Determines whether the app runs standalone (everything in SQLite, no network)
// or against a server (cloud entities from core-api, collaboration enabled).
//
// Local is the default: a fresh install must work with no account, no server,
// and no configuration. Team mode is opted into explicitly by writing a
// serverUrl into config.json.
//
// Read once at startup and cached — switching modes requires a restart, since
// the repository bindings in repositories/index.ts are resolved at module load.

import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ensureAppDir } from './migrate-app-dir'

export const AppMode = {
  Local: 'local',
  Team: 'team'
} as const

export type AppMode = (typeof AppMode)[keyof typeof AppMode]

export type AppConfig = {
  mode: AppMode
  /** Base URL of a self-hosted server, e.g. http://10.0.0.4:3003 — team mode only. */
  serverUrl: string | null
  /** Shared server token, or null when the server uses OIDC. */
  serverToken: string | null
  /** Opt-in. Analytics are never enabled without an explicit true here. */
  telemetryEnabled: boolean
}

const DEFAULT_CONFIG: AppConfig = {
  mode: AppMode.Local,
  serverUrl: null,
  serverToken: null,
  telemetryEnabled: false
}

let cached: AppConfig | null = null

function configPath(): string {
  // ensureAppDir handles the ~/.tracigo → ~/.braid migration and creates the
  // directory. Never join this path by hand — see migrate-app-dir.ts.
  return join(ensureAppDir(), 'config.json')
}

export function getConfig(): AppConfig {
  if (cached) return cached

  const path = configPath()
  if (!existsSync(path)) {
    cached = DEFAULT_CONFIG
    writeFileSync(path, JSON.stringify(DEFAULT_CONFIG, null, 2))
    return cached
  }

  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AppConfig>
    cached = {
      ...DEFAULT_CONFIG,
      ...parsed,
      // A team-mode config with no server URL is unusable — fall back to local
      // rather than starting an app that cannot load a single project.
      mode: parsed.mode === AppMode.Team && parsed.serverUrl ? AppMode.Team : AppMode.Local
    }
  } catch {
    console.warn('[app-mode] config.json is unreadable — falling back to local mode')
    cached = DEFAULT_CONFIG
  }

  return cached
}

export function isLocalMode(): boolean {
  return getConfig().mode === AppMode.Local
}

export function getServerUrl(): string | null {
  return getConfig().serverUrl
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...getConfig(), ...patch }
  writeFileSync(configPath(), JSON.stringify(next, null, 2))
  cached = next
  return next
}
