import { contextBridge, ipcRenderer } from 'electron'

const IPC_CHANNELS = {
  START: 'braid:dictation:start',
  STOP: 'braid:dictation:stop',
  VOLUME: 'braid:dictation:volume',
  AUDIO_RESULT: 'braid:dictation:audio-result',
  ERROR: 'braid:dictation:error'
} as const

contextBridge.exposeInMainWorld('dictationApi', {
  onStart(callback: () => void): void {
    ipcRenderer.on(IPC_CHANNELS.START, () => callback())
  },
  onStop(callback: () => void): void {
    ipcRenderer.on(IPC_CHANNELS.STOP, () => callback())
  },
  sendVolume(levels: number[]): void {
    ipcRenderer.send(IPC_CHANNELS.VOLUME, levels)
  },
  sendAudioResult(wavBase64: string): void {
    ipcRenderer.send(IPC_CHANNELS.AUDIO_RESULT, wavBase64)
  },
  sendError(error: string): void {
    ipcRenderer.send(IPC_CHANNELS.ERROR, error)
  }
})
