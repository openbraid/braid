// Dictation service — orchestrates audio capture and whisper transcription.
//
// Architecture:
//   Terminal SPA → WebSocket → Express server → DictationService
//     → AudioCaptureWindow (hidden BrowserWindow, mic capture)
//     → whisper-cli (transcription)
//     → text-cleanup (filler removal)
//   Results flow back the same path.
//
// The terminal SPA cannot access getUserMedia because it runs inside
// a VS Code webview iframe (VS Code blocks media access by design).
// Audio capture is done in a hidden BrowserWindow instead.

import { AudioCaptureWindow } from './audio-capture'
import { warmup, transcribe, isBinaryReady } from './whisper'
import { cleanTranscription } from './text-cleanup'
import { isModelReady, ensureModelDownloaded } from './model-manager'

// ─── Callback type for sending messages back to the terminal SPA ────────────

type SendToClient = (msg: { type: string; [key: string]: unknown }) => void

// ─── Singleton instance ─────────────────────────────────────────────────────

const audioCaptureWindow = new AudioCaptureWindow()

// ─── Initialization (called once on app startup) ────────────────────────────

/**
 * Prepare dictation infrastructure in the background.
 * - Downloads the whisper model if not present (silent, no UI).
 * - Pre-creates the hidden audio capture window so Cmd+D is instant.
 *
 * Call this early in the app lifecycle (e.g., in app.whenReady).
 */
export function initializeDictation(): void {
  // Start model download if needed (fire-and-forget)
  ensureModelDownloaded()

  // NOTE: Do NOT preWarm the audio capture window here.
  // Creating a BrowserWindow at startup causes macOS to silently auto-deny
  // microphone access before the user ever triggers dictation.
  // The window is created lazily on first Cmd+D instead (~1s delay, one time only).
}

// ─── Recording ──────────────────────────────────────────────────────────────

/**
 * Start recording microphone audio.
 * Volume levels are streamed back to the client for waveform visualization.
 * Also triggers whisper model warmup in parallel.
 *
 * If the model isn't downloaded yet, sends a friendly error instead of starting.
 */
export function startRecording(sendToClient: SendToClient): void {
  if (!isModelReady() || !isBinaryReady()) {
    sendToClient({
      type: 'DICTATION.ERROR',
      error: 'Setting up voice dictation... try again in a moment.'
    })
    return
  }

  // Warm up whisper model in parallel while user speaks
  warmup().catch((err) => {
    console.warn('[dictation] Warmup failed (non-fatal):', err)
  })

  audioCaptureWindow.startRecording({
    onVolumeLevels: (levels) => {
      sendToClient({ type: 'DICTATION.VOLUME', levels })
    },

    onAudioCaptured: (wavBase64) => {
      transcribeAndRespond(wavBase64, sendToClient)
    },

    onError: (error) => {
      console.error('[dictation] Recording error:', error)
      sendToClient({ type: 'DICTATION.ERROR', error })
    },

    onStatus: (message) => {
      sendToClient({ type: 'DICTATION.STATUS', message })
    }
  })
}

/**
 * Stop recording. Audio processing and transcription happen asynchronously.
 * Results are delivered via the sendToClient callback passed to startRecording.
 */
export function stopRecording(): void {
  audioCaptureWindow.stopRecording()
}

/** Whether a recording session is currently active (terminal or Scratch). */
export function isRecording(): boolean {
  return audioCaptureWindow.isRecording()
}

/** Return the webContents ID of the audio capture window (for scoping permissions). */
export function getAudioCaptureWebContentsId(): number | null {
  return audioCaptureWindow.getWebContentsId()
}

/**
 * Release all resources. Call on app quit.
 */
export function disposeDictation(): void {
  audioCaptureWindow.dispose()
}

// ─── Internal ───────────────────────────────────────────────────────────────

async function transcribeAndRespond(wavBase64: string, sendToClient: SendToClient): Promise<void> {
  try {
    const audioBuffer = Buffer.from(wavBase64, 'base64')
    console.log(`[dictation] Transcribing ${audioBuffer.length} bytes...`)
    const startTime = Date.now()

    const rawText = await transcribe(audioBuffer)
    console.log(`[dictation] Raw transcription (${Date.now() - startTime}ms): "${rawText}"`)

    const cleanedText = cleanTranscription(rawText)
    console.log(`[dictation] Cleaned: "${cleanedText}"`)

    sendToClient({ type: 'DICTATION.RESULT', text: cleanedText })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transcription failed'
    console.error('[dictation] Transcription error:', err)
    sendToClient({ type: 'DICTATION.ERROR', error: message })
  }
}
