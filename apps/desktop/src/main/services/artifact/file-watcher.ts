// ─── Artifact file watcher ───────────────────────────────────────────────────
// Watches .braid/{workspaceName}/ for YAML file changes.
// Debounces events, ignores own writes via hash comparison,
// and pushes ARTIFACT_FILE_CHANGED to the renderer on external changes.

import { watch, readFileSync, existsSync, statSync } from 'fs'
import { join, extname } from 'path'
import type { FSWatcher } from 'fs'
import * as yaml from 'js-yaml'

import type { ArtifactKind } from '../../../shared/ipc-types'
import { Channels } from '../../../shared/ipc-types'
import { contentHash } from './index'

type PushFn = (channel: string, payload: unknown) => void

// ─── State ───────────────────────────────────────────────────────────────────

/** Active watchers keyed by braidDir path */
const watchers = new Map<string, FSWatcher>()

/** Debounce timers keyed by braidDir path */
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Last content hash we wrote, keyed by absolute file path */
const lastWrittenHashes = new Map<string, string>()

/** Content hash cache of last known state, keyed by absolute file path */
const knownHashes = new Map<string, string>()

const DEBOUNCE_MS = 500

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Called by writeArtifactFile after writing to disk.
 * Stores the hash so the watcher can skip the next change event (our own write).
 */
export function setLastWrittenHash(filePath: string, hash: string): void {
  lastWrittenHashes.set(filePath, hash)
  knownHashes.set(filePath, hash)
}

/**
 * Start watching .braid/{workspaceName}/ for YAML changes.
 * Pushes ARTIFACT_FILE_CHANGED when an external edit is detected.
 */
export function startWatching(
  braidDir: string,
  workspaceId: string,
  push: PushFn
): void {
  // Don't double-watch
  if (watchers.has(braidDir)) return

  if (!existsSync(braidDir)) {
    console.log(`[artifact-watcher] Directory does not exist, skipping: ${braidDir}`)
    return
  }

  try {
    const watcher = watch(braidDir, { persistent: true }, (_eventType, fileName) => {
      if (!fileName) return
      const ext = extname(fileName).toLowerCase()
      if (ext !== '.yaml' && ext !== '.yml') return

      // Debounce: multiple events fire for a single write
      const timerKey = `${braidDir}:${fileName}`
      const existing = debounceTimers.get(timerKey)
      if (existing) clearTimeout(existing)

      debounceTimers.set(
        timerKey,
        setTimeout(() => {
          debounceTimers.delete(timerKey)
          handleFileChange(braidDir, fileName, workspaceId, push)
        }, DEBOUNCE_MS)
      )
    })

    watchers.set(braidDir, watcher)
    console.log(`[artifact-watcher] Started watching: ${braidDir}`)
  } catch (err) {
    console.error(`[artifact-watcher] Failed to watch ${braidDir}:`, err)
  }
}

/**
 * Stop watching a directory. Called on workspace close.
 */
export function stopWatching(braidDir: string): void {
  const watcher = watchers.get(braidDir)
  if (watcher) {
    watcher.close()
    watchers.delete(braidDir)
    console.log(`[artifact-watcher] Stopped watching: ${braidDir}`)
  }

  // Clean up debounce timers for this dir
  for (const [key, timer] of debounceTimers.entries()) {
    if (key.startsWith(braidDir)) {
      clearTimeout(timer)
      debounceTimers.delete(key)
    }
  }
}

/**
 * Stop all watchers. Called on app quit.
 */
export function stopAllWatchers(): void {
  for (const [dir, watcher] of watchers.entries()) {
    watcher.close()
    console.log(`[artifact-watcher] Stopped watching: ${dir}`)
  }
  watchers.clear()
  for (const timer of debounceTimers.values()) {
    clearTimeout(timer)
  }
  debounceTimers.clear()
}

// ─── Internal ────────────────────────────────────────────────────────────────

function handleFileChange(
  braidDir: string,
  fileName: string,
  workspaceId: string,
  push: PushFn
): void {
  const filePath = join(braidDir, fileName)

  // Check if file still exists (could be a delete event)
  if (!existsSync(filePath)) {
    console.log(`[artifact-watcher] File deleted: ${filePath}`)
    knownHashes.delete(filePath)
    lastWrittenHashes.delete(filePath)
    // Notify renderer so it can re-run loadArtifacts and prune the kind
    push(Channels.ARTIFACT_FILE_CHANGED, { workspaceId, kind: '', fileName })
    return
  }

  try {
    const stat = statSync(filePath)
    if (!stat.isFile()) return

    const content = readFileSync(filePath, 'utf-8')
    const hash = contentHash(content)

    // Check if this is our own write
    const lastWritten = lastWrittenHashes.get(filePath)
    if (lastWritten === hash) {
      lastWrittenHashes.delete(filePath) // one-time skip
      return
    }

    // Check if content actually changed from last known state
    const known = knownHashes.get(filePath)
    if (known === hash) return

    // Content changed externally — update cache and notify
    knownHashes.set(filePath, hash)

    // Extract kind from the file's meta block
    const kind = extractKindFromYaml(content)

    if (kind) {
      console.log(`[artifact-watcher] External change detected: ${kind} in ${fileName}`)
      push(Channels.ARTIFACT_FILE_CHANGED, { workspaceId, kind, fileName })
    } else {
      // YAML is invalid or missing meta — still notify so the UI can refresh errors.
      // Use empty string for kind; the renderer will re-run loadArtifacts to pick up file errors.
      console.log(`[artifact-watcher] Invalid file changed: ${fileName}`)
      push(Channels.ARTIFACT_FILE_CHANGED, { workspaceId, kind: '', fileName })
    }
  } catch (err) {
    console.error(`[artifact-watcher] Error handling change for ${filePath}:`, err)
  }
}

function extractKindFromYaml(content: string): ArtifactKind | null {
  try {
    const parsed = yaml.load(content) as Record<string, unknown> | null
    if (!parsed || typeof parsed !== 'object') return null
    const meta = parsed.meta as Record<string, unknown> | undefined
    if (!meta || typeof meta !== 'object') return null
    const kind = meta.kind
    if (typeof kind !== 'string') return null
    return kind as ArtifactKind
  } catch {
    return null
  }
}
