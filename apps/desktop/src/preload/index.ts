import { contextBridge, ipcRenderer } from 'electron'
import type { InvokeMap, PushMap } from '../shared/ipc-types'

type InvokeChannel = keyof InvokeMap
type PushChannel = keyof PushMap

const api = {
  async invoke<C extends InvokeChannel>(
    channel: C,
    payload?: InvokeMap[C]['payload']
  ): Promise<InvokeMap[C]['response']> {
    const result = await ipcRenderer.invoke(channel, payload)

    // Unwrap the result envelope from handleIpc.
    // { ok: true, data } → return data
    // { ok: false, error: { code, message } } → throw Error with .code
    if (result && typeof result === 'object' && 'ok' in result) {
      if (result.ok) return result.data
      // Throw a plain object — not an Error instance.
      // Electron's contextBridge strips custom properties from Error objects
      // during serialization, so `.code` would be lost. Plain objects survive intact.
      throw { code: result.error.code, message: result.error.message }
    }

    // Fallback for handlers not using handleIpc (e.g. raw ipcMain.handle)
    return result
  },

  on<C extends PushChannel>(
    channel: C,
    listener: (payload: PushMap[C]) => void
  ): () => void {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: PushMap[C]): void =>
      listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },

  copyToClipboard(text: string): void {
    ipcRenderer.send('clipboard:write', text)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
