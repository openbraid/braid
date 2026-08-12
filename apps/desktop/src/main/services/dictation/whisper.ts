// Manages whisper-cli binary: locating, warmup, and transcription.
// Uses one-shot spawns — no persistent server, no port, no RAM cost when idle.
//
// The binary + shared libs are bundled at resources/whisper/darwin-arm64/.
// In production, afterPack copies them to Contents/Resources/whisper/.
// In development, falls back to system-installed whisper-cli (e.g., Homebrew).

import { spawn } from 'child_process'
import { writeFile, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { app as electronApp } from 'electron'
import { getModelPath } from './model-manager'

// ─── Binary resolution ──────────────────────────────────────────────────────

function resolveWhisperBinary(): string {
  if (electronApp.isPackaged) {
    const platform = process.platform
    const arch = process.arch
    const ext = platform === 'win32' ? '.exe' : ''
    return join(
      process.resourcesPath,
      'whisper',
      `${platform}-${arch}`,
      `whisper-cli${ext}`
    )
  }
  // Development: use system-installed whisper-cli (e.g., from Homebrew)
  return 'whisper-cli'
}

export function isBinaryReady(): boolean {
  if (!electronApp.isPackaged) return true
  return existsSync(resolveWhisperBinary())
}

// ─── Silent WAV for warmup ──────────────────────────────────────────────────
// 0.1s of silence at 16kHz mono 16-bit. Generated once, reused.

function generateSilentWav(): Buffer {
  const sampleRate = 16000
  const numSamples = Math.floor(sampleRate * 0.1)
  const dataSize = numSamples * 2
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  return buffer
}

const SILENT_WAV = generateSilentWav()

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Warmup: spawn whisper-cli with a tiny silent WAV to load the model into
 * the OS page cache. Fire-and-forget. If already cached, returns in ~200ms.
 * Safe to call multiple times — idempotent.
 */
export async function warmup(): Promise<void> {
  if (!isBinaryReady()) {
    throw new Error('whisper-cli binary not found')
  }
  const tmpPath = join(tmpdir(), `braid-warmup-${Date.now()}.wav`)
  try {
    await writeFile(tmpPath, SILENT_WAV)
    await runWhisper(tmpPath, 30000)
  } catch (err) {
    console.warn('[whisper] Warmup failed (non-fatal):', err)
  } finally {
    unlink(tmpPath).catch(() => {})
  }
}

/**
 * Transcribe a WAV audio buffer. Returns the raw transcription text.
 * Expects 16kHz mono 16-bit PCM WAV.
 */
export async function transcribe(wavBuffer: Buffer): Promise<string> {
  if (!isBinaryReady()) {
    throw new Error('whisper-cli binary not found')
  }
  const tmpPath = join(tmpdir(), `braid-dictation-${Date.now()}.wav`)
  try {
    await writeFile(tmpPath, wavBuffer)
    const result = await runWhisper(tmpPath, 30000)
    return result
  } finally {
    unlink(tmpPath).catch(() => {})
  }
}

// ─── Internal ───────────────────────────────────────────────────────────────

function runWhisper(wavPath: string, timeoutMs: number): Promise<string> {
  const whisperBin = resolveWhisperBinary()

  return new Promise((resolve, reject) => {
    const args = [
      '-m', getModelPath(),
      '-f', wavPath,
      '--no-prints',     // suppress progress/debug output
      '--no-timestamps', // just the text, no [00:00:00 --> ...] prefixes
      '-l', 'en'         // force English
    ]

    const proc = spawn(whisperBin, args, {
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    proc.on('close', (code, signal) => {
      if (code === 0) {
        resolve(stdout.trim())
      } else {
        reject(new Error(`whisper-cli exited with code ${code} signal ${signal}: ${stderr.trim()}`))
      }
    })

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn whisper-cli: ${err.message}`))
    })
  })
}
