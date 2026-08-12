import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { app } from 'electron'
import { existsSync, renameSync } from 'fs'
import { join } from 'path'
import * as schema from './schema'
import { ensureAppDir } from '../lib/migrate-app-dir'

// Migrates ~/.tracigo → ~/.braid on first run if needed, then creates the
// directory. Must be the first thing that touches it — see migrate-app-dir.ts.
const appDir = ensureAppDir()

// The database file was renamed alongside the directory. Renaming the directory
// alone would leave tracigo.db in place and open a new, empty braid.db beside
// it — every project and workspace would appear to have vanished.
//
// WAL mode means two sidecar files travel with the database. Moving the main
// file without them leaves SQLite to recover from a -wal belonging to a
// different database name, so all three move together.
const dbPath = join(appDir, 'braid.db')
const legacyDbPath = join(appDir, 'tracigo.db')

if (!existsSync(dbPath) && existsSync(legacyDbPath)) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(legacyDbPath + suffix)) {
      renameSync(legacyDbPath + suffix, dbPath + suffix)
    }
  }
  console.log(`[db] migrated ${legacyDbPath} → ${dbPath}`)
}

const sqlite = new Database(dbPath)

sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })

// In dev: __dirname = out/main → ../../drizzle = project root /drizzle
// In prod: __dirname = resources/app.asar/out/main → same relative path works
const migrationsFolder = join(__dirname, '../../drizzle')

try {
  migrate(db, { migrationsFolder })
} catch (err) {
  console.error('[db] Migration failed — cannot start with inconsistent database state:', err)
  app.exit(1)
}

