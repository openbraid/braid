// Hidden BrowserWindow for microphone audio capture.
//
// getUserMedia is blocked inside VS Code webview iframes (intentional security
// restriction by VS Code). We work around this by capturing audio in a separate
// hidden BrowserWindow, which has full access to Web Audio APIs.
//
// Lifecycle:
//   - Window is created lazily on first recording request.
//   - Stays alive between recordings to avoid creation overhead.
//   - Disposed when the app quits.

import { BrowserWindow, ipcMain, systemPreferences } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── IPC channels (namespaced to avoid collisions) ──────────────────────────

const IPC_CHANNELS = {
  START: 'braid:dictation:start',
  STOP: 'braid:dictation:stop',
  VOLUME: 'braid:dictation:volume',
  AUDIO_RESULT: 'braid:dictation:audio-result',
  ERROR: 'braid:dictation:error'
} as const

// ─── Callback types ─────────────────────────────────────────────────────────

export type RecordingCallbacks = {
  onVolumeLevels: (levels: number[]) => void
  onAudioCaptured: (wavBase64: string) => void
  onError: (error: string) => void
  onStatus?: (message: string) => void
}

// ─── AudioCaptureWindow ─────────────────────────────────────────────────────

export class AudioCaptureWindow {
  private window: BrowserWindow | null = null
  private callbacks: RecordingCallbacks | null = null
  private _isRecording = false
  private ipcRegistered = false

  /**
   * Request OS-level microphone access (macOS only).
   * Returns true if granted, false if denied.
   * On Windows/Linux, always returns true (no system prompt needed).
   */
  async requestMicrophoneAccess(): Promise<boolean> {
    if (process.platform !== 'darwin') return true

    const status = systemPreferences.getMediaAccessStatus('microphone')
    console.log(`[audio-capture] Microphone status: ${status}`)
    console.log(`[audio-capture] App path: ${process.execPath}`)
    console.log(`[audio-capture] App bundled: ${require('electron').app.isPackaged}`)

    if (status === 'granted') return true

    // Always attempt askForMediaAccess — even if status is 'denied'.
    // After tccutil reset, getMediaAccessStatus can still report 'denied'
    // on some macOS versions until askForMediaAccess is explicitly called.
    console.log(`[audio-capture] Calling askForMediaAccess...`)
    const result = await systemPreferences.askForMediaAccess('microphone')
    console.log(`[audio-capture] askForMediaAccess result: ${result}`)

    if (!result) {
      // Re-check status after the ask — helps diagnose the actual OS state
      const postStatus = systemPreferences.getMediaAccessStatus('microphone')
      console.log(`[audio-capture] Post-ask status: ${postStatus}`)
    }

    return result
  }

  /**
   * Pre-create the hidden BrowserWindow so the first Cmd+D has no delay.
   * The window is created and the HTML page is loaded, but no recording starts.
   * Call this on app startup — it's a ~1-2s operation that runs in background.
   */
  async preWarm(): Promise<void> {
    await this.ensureWindow()
    console.log('[audio-capture] Hidden window pre-warmed')
  }

  /**
   * Start capturing microphone audio.
   * Creates the hidden window on first call, reuses it for subsequent calls.
   * Volume levels are streamed via onVolumeLevels callback (~20 times/sec).
   */
  async startRecording(callbacks: RecordingCallbacks): Promise<void> {
    const hasAccess = await this.requestMicrophoneAccess()
    if (!hasAccess) {
      callbacks.onError(
        'Microphone access denied by the operating system. ' +
        'Please allow microphone access in System Settings > Privacy & Security > Microphone.'
      )
      return
    }

    this.callbacks = callbacks
    this._isRecording = true
    this.registerIpcListeners()

    const needsInit = !this.window || this.window.isDestroyed()
    if (needsInit) {
      callbacks.onStatus?.('Initializing microphone…')
    }

    await this.ensureWindow()
    this.window!.webContents.send(IPC_CHANNELS.START)
  }

  /** Whether a recording session is currently active. */
  isRecording(): boolean {
    return this._isRecording
  }

  /** Return the webContents ID of the hidden window (for scoping permissions). */
  getWebContentsId(): number | null {
    if (this.window && !this.window.isDestroyed()) {
      return this.window.webContents.id
    }
    return null
  }

  /**
   * Stop recording. The captured audio is processed asynchronously —
   * the result arrives via the onAudioCaptured callback.
   */
  stopRecording(): void {
    this._isRecording = false
    if (this.window) {
      this.window.webContents.send(IPC_CHANNELS.STOP)
    }
  }

  /**
   * Release all resources. Call on app quit.
   */
  dispose(): void {
    this._isRecording = false
    this.unregisterIpcListeners()
    this.window?.close()
    this.window = null
    this.callbacks = null
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private async ensureWindow(): Promise<void> {
    if (this.window && !this.window.isDestroyed()) return

    this.window = new BrowserWindow({
      show: false,
      width: 1,
      height: 1,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: join(__dirname, '../preload/audio-capture-preload.js')
      }
    })

    this.window.setMenu(null)

    // Load from file:// — getUserMedia requires a secure context,
    // and data: URLs don't qualify. The session permission handler
    // in index.ts grants media access to this window.
    const htmlPath = join(tmpdir(), 'braid-audio-capture.html')
    writeFileSync(htmlPath, buildCapturePageHtml(), 'utf-8')
    await this.window.loadFile(htmlPath)
  }

  private registerIpcListeners(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true

    ipcMain.on(IPC_CHANNELS.VOLUME, this.handleVolume)
    ipcMain.on(IPC_CHANNELS.AUDIO_RESULT, this.handleAudioResult)
    ipcMain.on(IPC_CHANNELS.ERROR, this.handleError)
  }

  private unregisterIpcListeners(): void {
    if (!this.ipcRegistered) return
    this.ipcRegistered = false

    ipcMain.removeListener(IPC_CHANNELS.VOLUME, this.handleVolume)
    ipcMain.removeListener(IPC_CHANNELS.AUDIO_RESULT, this.handleAudioResult)
    ipcMain.removeListener(IPC_CHANNELS.ERROR, this.handleError)
  }

  // Arrow functions to preserve `this` binding when used as IPC handlers
  private handleVolume = (_event: Electron.IpcMainEvent, levels: number[]): void => {
    this.callbacks?.onVolumeLevels(levels)
  }

  private handleAudioResult = (_event: Electron.IpcMainEvent, wavBase64: string): void => {
    this.callbacks?.onAudioCaptured(wavBase64)
  }

  private handleError = (_event: Electron.IpcMainEvent, error: string): void => {
    this.callbacks?.onError(error)
  }
}

// ─── Hidden window HTML ─────────────────────────────────────────────────────
// Self-contained page that captures microphone audio, streams volume levels,
// and encodes captured audio as 16kHz mono WAV on stop.

function buildCapturePageHtml(): string {
  return `<!DOCTYPE html>
<html><head><title>Braid Audio Capture</title></head>
<body><script>
const api = window.dictationApi;

let mediaStream = null;
let audioContext = null;
let analyserNode = null;
let mediaRecorder = null;
let recordedChunks = [];
let volumeInterval = null;

// ── Start recording ───────────────────────────────────────────────────────

api.onStart(async () => {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true
      }
    });

    // Audio analysis for volume levels
    audioContext = new AudioContext({ sampleRate: 16000 });
    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 128;
    sourceNode.connect(analyserNode);

    // Media recording
    recordedChunks = [];
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : '';
    mediaRecorder = new MediaRecorder(mediaStream, mimeType ? { mimeType } : {});
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    };
    mediaRecorder.start(100);

    // Stream volume levels to main process (~20fps)
    const frequencyData = new Uint8Array(analyserNode.frequencyBinCount);
    volumeInterval = setInterval(() => {
      analyserNode.getByteFrequencyData(frequencyData);
      api.sendVolume(Array.from(frequencyData));
    }, 50);

  } catch (err) {
    releaseResources();
    api.sendError(err.message || 'Failed to access microphone');
  }
});

// ── Stop recording ────────────────────────────────────────────────────────

api.onStop(() => {
  clearInterval(volumeInterval);
  volumeInterval = null;

  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    api.sendError('Not currently recording');
    return;
  }

  mediaRecorder.onstop = async () => {
    try {
      const audioBlob = new Blob(recordedChunks, { type: mediaRecorder.mimeType });
      const wavBase64 = await encodeAsWavBase64(audioBlob);
      api.sendAudioResult(wavBase64);
    } catch (err) {
      api.sendError(err.message || 'Failed to encode audio');
    } finally {
      releaseResources();
    }
  };

  mediaRecorder.stop();
});

// ── WAV encoding ──────────────────────────────────────────────────────────

async function encodeAsWavBase64(audioBlob) {
  const arrayBuffer = await audioBlob.arrayBuffer();

  // Decode the recorded audio (handles webm, ogg, etc.)
  const decodeContext = new AudioContext();
  const decodedAudio = await decodeContext.decodeAudioData(arrayBuffer);
  await decodeContext.close();

  // Resample to 16kHz mono (whisper's expected format)
  const targetSampleRate = 16000;
  const outputLength = Math.ceil(decodedAudio.duration * targetSampleRate);
  const offlineContext = new OfflineAudioContext(1, outputLength, targetSampleRate);
  const bufferSource = offlineContext.createBufferSource();
  bufferSource.buffer = decodedAudio;
  bufferSource.connect(offlineContext.destination);
  bufferSource.start();
  const resampledBuffer = await offlineContext.startRendering();

  // Encode as 16-bit PCM WAV
  const pcmSamples = resampledBuffer.getChannelData(0);
  const wavArrayBuffer = encodePcmToWav(pcmSamples, targetSampleRate);

  // Convert to base64
  const wavBytes = new Uint8Array(wavArrayBuffer);
  let binaryString = '';
  for (let i = 0; i < wavBytes.length; i++) {
    binaryString += String.fromCharCode(wavBytes[i]);
  }
  return btoa(binaryString);
}

function encodePcmToWav(samples, sampleRate) {
  const numSamples = samples.length;
  const pcmDataSize = numSamples * 2; // 16-bit = 2 bytes per sample
  const wavBuffer = new ArrayBuffer(44 + pcmDataSize);
  const view = new DataView(wavBuffer);

  // RIFF header
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcmDataSize, true);
  writeAscii(view, 8, 'WAVE');

  // fmt chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);       // chunk size
  view.setUint16(20, 1, true);        // PCM format
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);        // block align
  view.setUint16(34, 16, true);       // bits per sample

  // data chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcmDataSize, true);

  // Write samples (float32 → int16)
  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF, true);
    offset += 2;
  }

  return wavBuffer;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────

function releaseResources() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  audioContext?.close();
  audioContext = null;
  analyserNode = null;
  mediaRecorder = null;
  recordedChunks = [];
}
</script></body></html>`
}
