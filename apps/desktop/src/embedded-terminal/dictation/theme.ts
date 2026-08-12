// Dictation UI color tokens — resolved dynamically from shared theme.
// Updated when theme changes via WebSocket.

import type { ThemeKind, DictationThemeTokens } from '../../shared/theme'
import { getThemeByKind } from '../../shared/theme'

export function getDictationColors(kind: ThemeKind): DictationThemeTokens {
  return getThemeByKind(kind).dictation
}

// Default for initial render
export const dictationColors: DictationThemeTokens = getDictationColors('dark')
