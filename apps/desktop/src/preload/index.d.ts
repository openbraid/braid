import type { InvokeMap, PushMap } from '../shared/ipc-types'

type InvokeChannel = keyof InvokeMap
type PushChannel = keyof PushMap

export interface BraidApi {
  invoke<C extends InvokeChannel>(
    channel: C,
    payload?: InvokeMap[C]['payload']
  ): Promise<InvokeMap[C]['response']>

  on<C extends PushChannel>(
    channel: C,
    listener: (payload: PushMap[C]) => void
  ): () => void

  copyToClipboard(text: string): void
}

declare global {
  interface Window {
    api: BraidApi
  }
}
