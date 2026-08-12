// ─── Artifact Sync State ──────────────────────────────────────────────────────
// Persists the "base version" and "base YAML content" for each artifact across
// app restarts.
//
// The base version represents the last time the user explicitly synced with
// the server (via Save or Pull latest). Used for:
//   - Conflict detection: polling compares server version against base version
//   - Save sends expectedVersion = base version → server rejects if mismatched
//   - Change detection: compare current YAML against base YAML → enable/disable Save
//
// Storage: ~/.braid/sync-state.json
// Format:  { "workspaceId:kind": { version, yamlContent }, ... }
//
// Each workspace + artifact kind has an independent entry.
// Cleaned up when workspace is closed with file removal.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { ensureAppDir } from './migrate-app-dir'

// ─── Types ──────────────────────────────────────────────────────────────────

type SyncEntry = { version: number; yamlContent: string }
type SyncState = Record<string, number | SyncEntry>

// ─── File path ──────────────────────────────────────────────────────────────

function getSyncStatePath(): string {
  const dir = ensureAppDir()
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return join(dir, 'sync-state.json')
}

// ─── Read / Write ───────────────────────────────────────────────────────────

function readSyncState(): SyncState {
  const filePath = getSyncStatePath()
  try {
    if (!existsSync(filePath)) return {}
    const raw = readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

function writeSyncState(state: SyncState): void {
  const filePath = getSyncStatePath()
  writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf-8')
}

// ─── Key format ─────────────────────────────────────────────────────────────

function makeKey(workspaceId: string, kind: string): string {
  return `${workspaceId}:${kind}`
}

/** Normalize entry — handles migration from old format (plain number) to new format (object). */
function readEntry(state: SyncState, key: string): SyncEntry | null {
  const value = state[key]
  if (value === undefined || value === null) return null
  // Old format: just a number
  if (typeof value === 'number') return { version: value, yamlContent: '' }
  // New format: { version, yamlContent }
  if (typeof value === 'object' && 'version' in value) return value as SyncEntry
  return null
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get the persisted base version for an artifact.
 * Returns null if no version has been persisted.
 */
export function getArtifactSyncVersion(
  workspaceId: string,
  kind: string,
): number | null {
  const state = readSyncState()
  const entry = readEntry(state, makeKey(workspaceId, kind))
  return entry?.version ?? null
}

/**
 * Get the persisted base YAML content for an artifact.
 * Returns null if not persisted (first open, old format, or cleaned up).
 */
export function getArtifactBaseYaml(
  workspaceId: string,
  kind: string,
): string | null {
  const state = readSyncState()
  const entry = readEntry(state, makeKey(workspaceId, kind))
  return entry?.yamlContent || null
}

/**
 * Set the persisted base version and YAML content for an artifact.
 * Called after successful Save or Pull latest.
 */
export function setArtifactSyncState(
  workspaceId: string,
  kind: string,
  version: number,
  yamlContent: string,
): void {
  const state = readSyncState()
  state[makeKey(workspaceId, kind)] = { version, yamlContent }
  writeSyncState(state)
}

/** @deprecated Use setArtifactSyncState instead. Kept for backward compat. */
export function setArtifactSyncVersion(
  workspaceId: string,
  kind: string,
  version: number,
): void {
  const state = readSyncState()
  const existing = readEntry(state, makeKey(workspaceId, kind))
  state[makeKey(workspaceId, kind)] = { version, yamlContent: existing?.yamlContent ?? '' }
  writeSyncState(state)
}

/**
 * Remove all persisted sync state for a workspace.
 * Called when workspace is closed with file removal (closed_clean).
 */
export function clearWorkspaceSyncVersions(workspaceId: string): void {
  const state = readSyncState()
  const prefix = `${workspaceId}:`
  let changed = false
  for (const key of Object.keys(state)) {
    if (key.startsWith(prefix)) {
      delete state[key]
      changed = true
    }
  }
  if (changed) {
    writeSyncState(state)
  }
}
