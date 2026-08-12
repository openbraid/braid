// Dynamic xterm.js theme — resolves from shared theme tokens.
// Imported by Terminal.tsx, updated when theme changes via WebSocket.

import type { ITheme } from '@xterm/xterm'
import type { ThemeKind } from '../shared/theme'
import { getThemeByKind } from '../shared/theme'

export function getTerminalTheme(kind: ThemeKind): ITheme {
  return getThemeByKind(kind).terminal
}

// Default for initial render before theme message arrives
export const terminalTheme: ITheme = getTerminalTheme('dark')
