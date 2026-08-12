// Manages the whisper model file lifecycle:
//   - Checks if the model exists and is valid
//   - Downloads it in the background on first app launch
//   - Uses a lock file to prevent concurrent downloads across restarts
//
// Model is stored at ~/.braid/models/ggml-small.en.bin
// This is a hidden directory — users won't stumble on it accidentally.

import { createWriteStream, existsSync, statSync, unlinkSync, mkdirSync } from 'fs'
import { join } from 'path'
import { get } from 'https'
import type { IncomingMessage } from 'http'
import { ensureAppDir } from '../../lib/migrate-app-dir'

const MODEL_FILENAME = 'ggml-small.en.bin'
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin'
const EXPECTED_SIZE_BYTES = 487_600_000 // ~466MB, approximate lower bound for validation
const LOCK_FILENAME = '.downloading'
const LOCK_STALE_MS = 10 * 60 * 1000 // 10 minutes — after this, assume download crashed

// ─── Paths ──────────────────────────────────────────────────────────────────

function getModelsDir(): string {
  return join(ensureAppDir(), 'models')
}

export function getModelPath(): string {
  return join(getModelsDir(), MODEL_FILENAME)
}

function getLockPath(): string {
  return join(getModelsDir(), LOCK_FILENAME)
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Check if the model file exists and has a reasonable size.
 * Returns false if missing, too small (corrupt/partial), or zero bytes.
 */
export function isModelReady(): boolean {
  const modelPath = getModelPath()
  if (!existsSync(modelPath)) return false

  try {
    const stats = statSync(modelPath)
    return stats.size >= EXPECTED_SIZE_BYTES
  } catch {
    return false
  }
}

// ─── Download ───────────────────────────────────────────────────────────────

/**
 * Download the whisper model in the background if it's not already present.
 * Safe to call on every app startup — skips if model exists or download is in progress.
 *
 * This function is fire-and-forget. It logs progress but doesn't block the app.
 */
export function ensureModelDownloaded(): void {
  if (isModelReady()) {
    console.log('[model-manager] Model already downloaded')
    return
  }

  if (isDownloadInProgress()) {
    console.log('[model-manager] Download already in progress (lock file exists), skipping')
    return
  }

  // Clean up any partial file from a previous failed download
  const modelPath = getModelPath()
  if (existsSync(modelPath)) {
    console.log('[model-manager] Removing corrupt/partial model file')
    try { unlinkSync(modelPath) } catch { /* ignore */ }
  }

  downloadModel().catch((err) => {
    console.error('[model-manager] Download failed:', err)
    releaseLock()
  })
}

async function downloadModel(): Promise<void> {
  const modelsDir = getModelsDir()
  mkdirSync(modelsDir, { recursive: true })

  acquireLock()
  console.log(`[model-manager] Downloading model from ${MODEL_URL}`)

  const modelPath = getModelPath()
  const tempPath = `${modelPath}.partial`

  return new Promise((resolve, reject) => {
    function followRedirects(url: string, redirectCount = 0): void {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }

      get(url, (response: IncomingMessage) => {
        // Follow redirects (HuggingFace returns 301/302)
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          followRedirects(response.headers.location, redirectCount + 1)
          return
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`))
          return
        }

        const totalBytes = parseInt(response.headers['content-length'] ?? '0', 10)
        let downloadedBytes = 0
        let lastLogPercent = 0

        const fileStream = createWriteStream(tempPath)

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length
          const percent = totalBytes > 0 ? Math.floor((downloadedBytes / totalBytes) * 100) : 0

          // Log every 10%
          if (percent >= lastLogPercent + 10) {
            lastLogPercent = percent
            const mb = (downloadedBytes / 1024 / 1024).toFixed(0)
            const totalMb = (totalBytes / 1024 / 1024).toFixed(0)
            console.log(`[model-manager] Downloading: ${percent}% (${mb}/${totalMb} MB)`)
          }
        })

        response.pipe(fileStream)

        fileStream.on('finish', () => {
          fileStream.close()

          // Rename partial → final (atomic on most filesystems)
          try {
            const { renameSync } = require('fs')
            renameSync(tempPath, modelPath)
          } catch {
            reject(new Error('Failed to rename partial download to final path'))
            return
          }

          releaseLock()
          console.log(`[model-manager] Download complete: ${modelPath}`)
          resolve()
        })

        fileStream.on('error', (err) => {
          try { unlinkSync(tempPath) } catch { /* ignore */ }
          reject(err)
        })
      }).on('error', (err) => {
        reject(err)
      })
    }

    followRedirects(MODEL_URL)
  })
}

// ─── Lock file ──────────────────────────────────────────────────────────────

function acquireLock(): void {
  const lockPath = getLockPath()
  mkdirSync(getModelsDir(), { recursive: true })
  require('fs').writeFileSync(lockPath, `${Date.now()}`, 'utf-8')
}

function releaseLock(): void {
  const lockPath = getLockPath()
  try { unlinkSync(lockPath) } catch { /* ignore */ }
}

function isDownloadInProgress(): boolean {
  const lockPath = getLockPath()
  if (!existsSync(lockPath)) return false

  try {
    const lockContent = require('fs').readFileSync(lockPath, 'utf-8')
    const lockTime = parseInt(lockContent, 10)
    const age = Date.now() - lockTime

    if (age > LOCK_STALE_MS) {
      // Lock is stale — previous download likely crashed
      console.log(`[model-manager] Stale lock file (${Math.floor(age / 1000)}s old), removing`)
      releaseLock()
      return false
    }

    return true // active download in progress
  } catch {
    // Can't read lock — remove it
    releaseLock()
    return false
  }
}
