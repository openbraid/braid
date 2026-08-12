// ─── Shared utilities for session providers ──────────────────────────────────

import { readdir } from 'fs/promises'

/**
 * Convert an absolute filesystem path to the dash-encoded directory name
 * used by Claude, Factory Droid, and Qwen Code.
 * macOS:   /Users/foo/project   → -Users-foo-project
 * Windows: C:\Users\foo\project → -C-Users-foo-project
 */
export function toClaudeStyleDirName(absolutePath: string): string {
  return absolutePath.replace(/:/g, '').replace(/[\\/]/g, '-')
}

/**
 * Find all directories in `baseDir` that start with any of the given prefixes.
 * Returns directory names (not full paths).
 */
export async function prefixMatchDirs(baseDir: string, prefixes: string[]): Promise<string[]> {
  let allDirs: string[]
  try { allDirs = await readdir(baseDir) } catch { return [] }
  return allDirs.filter((dir) => prefixes.some((prefix) => dir.startsWith(prefix)))
}

/**
 * Read the first N lines of a file and return them as strings.
 * Stops early if the file has fewer lines.
 */
export async function readFirstLines(filePath: string, maxLines: number): Promise<string[]> {
  const { open } = await import('fs/promises')
  const lines: string[] = []
  let fh
  try {
    fh = await open(filePath, 'r')
    const stream = fh.readLines()
    for await (const line of stream) {
      lines.push(line)
      if (lines.length >= maxLines) break
    }
  } catch { /* ignore */ }
  finally { await fh?.close() }
  return lines
}
