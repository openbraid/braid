// ─── App directory migration ─────────────────────────────────────────────────
//
// The app's state directory moved from ~/.tracigo to ~/.braid. That directory
// holds the SQLite database, config.json, VS Code server data and extensions,
// generated .code-workspace files, and downloaded dictation models — i.e. every
// project and workspace the user has. Starting up against a fresh empty
// directory would present as total data loss.
//
// This migrates ENTRY BY ENTRY rather than renaming the whole directory.
// Renaming looks cleaner but is too fragile: `scripts/setup-extension.sh` runs
// on every `npm run dev`, before Electron starts, and creates
// ~/.braid/vscode-extensions directly. A whole-directory rename refuses to run
// once the destination exists, so a single external `mkdir` would strand the
// database forever. Merging survives that, and survives a migration that was
// interrupted halfway.
//
// Conflicts are resolved in favour of the NEW directory: if an entry already
// exists at the destination it is left untouched and the legacy copy is kept in
// place rather than deleted. Nothing is ever overwritten and nothing is ever
// removed — worst case the user is left with a stale directory they can delete.

import { existsSync, mkdirSync, readdirSync, renameSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { APP_DIR } from './derive-paths'

const LEGACY_APP_DIR = '.tracigo'

let resolved: string | null = null

/**
 * Returns the app directory, migrating and creating it on first call.
 *
 * Every module that reads or writes under the app directory calls this instead
 * of joining the path itself. That is deliberate: `db/index.ts` opens the
 * database at module load and `app-mode.ts` creates the directory to write
 * config.json, and ES module imports are hoisted — so whichever happens to be
 * evaluated first would otherwise create the directory and skip the migration.
 * Routing everything through one idempotent function removes the import-order
 * dependency entirely.
 */
export function ensureAppDir(): string {
  if (resolved) return resolved

  const legacyPath = join(homedir(), LEGACY_APP_DIR)
  const currentPath = join(homedir(), APP_DIR)

  mkdirSync(currentPath, { recursive: true })

  if (existsSync(legacyPath)) {
    migrateEntries(legacyPath, currentPath)
  }

  resolved = currentPath
  return resolved
}

function migrateEntries(legacyPath: string, currentPath: string): void {
  let entries: string[]
  try {
    entries = readdirSync(legacyPath)
  } catch (err) {
    console.warn(`[migrate-app-dir] could not read ${legacyPath}:`, err)
    return
  }

  const moved: string[] = []
  const skipped: string[] = []

  for (const entry of entries) {
    const from = join(legacyPath, entry)
    const to = join(currentPath, entry)

    if (existsSync(to)) {
      skipped.push(entry)
      continue
    }

    try {
      renameSync(from, to)
      moved.push(entry)
    } catch (err) {
      // Non-fatal per entry: a failure to move the dictation models should not
      // stop the app, and the database is handled separately by db/index.ts,
      // which refuses to start rather than open an empty file.
      console.warn(`[migrate-app-dir] could not move ${entry}:`, err)
      skipped.push(entry)
    }
  }

  if (moved.length > 0) {
    console.log(
      `[migrate-app-dir] moved ${moved.length} entries from ${legacyPath} to ${currentPath}: ${moved.join(', ')}`
    )
  }
  if (skipped.length > 0) {
    console.warn(
      `[migrate-app-dir] left ${skipped.length} entries in ${legacyPath} (already present at destination): ${skipped.join(', ')}`
    )
  }
}
