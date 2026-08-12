import { ipcMain } from 'electron'

// ─── Result envelope ─────────────────────────────────────────────────────────
//
// Electron IPC strips custom properties from thrown errors (only message survives).
// To preserve structured error codes, we wrap all results in an envelope:
//   { ok: true, data }       — success
//   { ok: false, error }     — failure with code + message
//
// The preload layer unwraps this so renderer code uses normal try/catch.

export type IpcError = {
  code: string
  message: string
}

export type IpcResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: IpcError }

function extractError(err: unknown): IpcError {
  const code = (err as { code?: string })?.code ?? 'INTERNAL_ERROR'
  const message = err instanceof Error ? err.message : String(err)
  return { code, message }
}

/**
 * Register an IPC handler with automatic error logging and result envelope.
 *
 * ALL new IPC handlers should use this instead of raw ipcMain.handle().
 * The only exception is terminal handlers (silent failure by design).
 */
export function handleIpc<P, R>(
  channel: string,
  fn: (payload: P) => R | Promise<R>
): void {
  ipcMain.handle(channel, async (_event, payload: P): Promise<IpcResult<R>> => {
    try {
      const data = await fn(payload)
      return { ok: true, data }
    } catch (err) {
      console.error(`[ipc] ${channel} failed:`, err)
      return { ok: false, error: extractError(err) }
    }
  })
}

/**
 * Variant that passes the raw IpcMainInvokeEvent — needed for handlers
 * that use event.sender (e.g. dialog).
 */
export function handleIpcWithEvent<P, R>(
  channel: string,
  fn: (event: Electron.IpcMainInvokeEvent, payload: P) => R | Promise<R>
): void {
  ipcMain.handle(channel, async (event, payload: P): Promise<IpcResult<R>> => {
    try {
      const data = await fn(event, payload)
      return { ok: true, data }
    } catch (err) {
      console.error(`[ipc] ${channel} failed:`, err)
      return { ok: false, error: extractError(err) }
    }
  })
}
