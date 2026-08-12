// Shared theme definitions — consumed by main process, renderer, and embedded terminal.
// Pure data, no framework dependencies.

export type ThemeKind = 'dark' | 'light'

// ─── Terminal theme tokens (xterm.js) ───────────────────────────────────────

export type TerminalThemeTokens = {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  selectionForeground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

// ─── Dictation UI tokens ────────────────────────────────────────────────────

export type DictationThemeTokens = {
  barBackground: string
  barBorder: string
  headerText: string
  hintText: string
  errorText: string
  inputBackground: string
  inputBorder: string
  inputText: string
  buttonText: string
  buttonBorder: string
  primaryButtonBackground: string
  primaryButtonText: string
  waveformActive: string
  waveformDim: string
  progressTrack: string
  progressFill: string
  recordingDot: string
}

// ─── Complete theme ─────────────────────────────────────────────────────────

export type AppTheme = {
  kind: ThemeKind
  terminal: TerminalThemeTokens
  dictation: DictationThemeTokens
  // VS Code theme to apply when Braid sets the theme
  vscodeThemeId: string
}

// ─── Dark theme ─────────────────────────────────────────────────────────────

export const DARK_THEME: AppTheme = {
  kind: 'dark',
  vscodeThemeId: 'Default Dark Modern',
  terminal: {
    background: '#141414',
    foreground: '#d4d4d4',
    cursor: '#d4d4d4',
    cursorAccent: '#141414',
    selectionBackground: '#264f78',
    selectionForeground: '#ffffff',
    black: '#1e1e1e',
    red: '#f44747',
    green: '#6a9955',
    yellow: '#d7ba7d',
    blue: '#569cd6',
    magenta: '#c586c0',
    cyan: '#4ec9b0',
    white: '#d4d4d4',
    brightBlack: '#808080',
    brightRed: '#f44747',
    brightGreen: '#6a9955',
    brightYellow: '#d7ba7d',
    brightBlue: '#569cd6',
    brightMagenta: '#c586c0',
    brightCyan: '#4ec9b0',
    brightWhite: '#ffffff'
  },
  dictation: {
    barBackground: '#1e1e1e',
    barBorder: '#3a3a3a',
    headerText: '#cccccc',
    hintText: '#666666',
    errorText: '#e55555',
    inputBackground: '#141414',
    inputBorder: '#333333',
    inputText: '#e0e0e0',
    buttonText: '#cccccc',
    buttonBorder: '#555555',
    primaryButtonBackground: '#C8674A',
    primaryButtonText: '#ffffff',
    waveformActive: '#888888',
    waveformDim: '#3a3a3a',
    progressTrack: '#333333',
    progressFill: '#888888',
    recordingDot: '#e05050'
  }
}

// ─── Light theme ────────────────────────────────────────────────────────────

export const LIGHT_THEME: AppTheme = {
  kind: 'light',
  vscodeThemeId: 'Default Light Modern',
  terminal: {
    background: '#ffffff',
    foreground: '#1a1a1a',
    cursor: '#1a1a1a',
    cursorAccent: '#ffffff',
    selectionBackground: '#add6ff',
    selectionForeground: '#000000',
    black: '#000000',
    red: '#cd3131',
    green: '#008000',
    yellow: '#795e26',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#1a1a1a',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#008000',
    brightYellow: '#795e26',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#000000'
  },
  dictation: {
    barBackground: '#f5f5f5',
    barBorder: '#d4d4d4',
    headerText: '#333333',
    hintText: '#999999',
    errorText: '#cd3131',
    inputBackground: '#ffffff',
    inputBorder: '#d4d4d4',
    inputText: '#1a1a1a',
    buttonText: '#333333',
    buttonBorder: '#c8c8c8',
    primaryButtonBackground: '#C8674A',
    primaryButtonText: '#ffffff',
    waveformActive: '#555555',
    waveformDim: '#d4d4d4',
    progressTrack: '#d4d4d4',
    progressFill: '#888888',
    recordingDot: '#e05050'
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function getThemeByKind(kind: ThemeKind): AppTheme {
  return kind === 'light' ? LIGHT_THEME : DARK_THEME
}
