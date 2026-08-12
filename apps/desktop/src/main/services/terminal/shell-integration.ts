// Shell integration for command completion detection.
// Injects precmd/preexec hooks into zsh and bash via ZDOTDIR / BASH_ENV.
// The hooks emit OSC 633 escape sequences that the PTY output parser detects.
// This is the same mechanism VS Code and iTerm2 use.

import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { ensureAppDir } from '../../lib/migrate-app-dir'

const INTEGRATION_DIR = join(ensureAppDir(), 'shell-integration')
const ZSH_DIR = join(INTEGRATION_DIR, 'zsh')
const BASH_INIT = join(INTEGRATION_DIR, 'bash-init.sh')

let initialized = false

/** Ensure shell integration scripts exist on disk. Called once at startup. */
export function ensureShellIntegration(): void {
  if (initialized) return
  initialized = true

  mkdirSync(ZSH_DIR, { recursive: true })

  // ── zsh ────────────────────────────────────────────────────────────────────
  // ZDOTDIR is set to this directory. zsh reads .zshenv first, then .zprofile,
  // .zshrc, .zlogin — all from ZDOTDIR. Each file sources the user's original,
  // and .zshrc appends our hooks AFTER the user's init completes.

  // IMPORTANT: Do NOT reset ZDOTDIR in .zshenv — zsh re-evaluates ZDOTDIR
  // before reading each subsequent file (.zprofile, .zshrc, .zlogin).
  // If we reset it here, zsh reads the user's .zshrc instead of ours,
  // and our hooks never load. ZDOTDIR stays as our custom dir until .zshrc
  // finishes setting up hooks.

  writeFileSync(join(ZSH_DIR, '.zshenv'), `\
# Braid shell integration — auto-generated, do not edit
# Source user's .zshenv (ZDOTDIR stays pointing here so zsh reads our other rc files)
[[ -f "\${BRAID_USER_ZDOTDIR:-\$HOME}/.zshenv" ]] && builtin source "\${BRAID_USER_ZDOTDIR:-\$HOME}/.zshenv"
`)

  writeFileSync(join(ZSH_DIR, '.zprofile'), `\
# Braid shell integration — auto-generated, do not edit
[[ -f "\${BRAID_USER_ZDOTDIR:-\$HOME}/.zprofile" ]] && builtin source "\${BRAID_USER_ZDOTDIR:-\$HOME}/.zprofile"
`)

  writeFileSync(join(ZSH_DIR, '.zshrc'), `\
# Braid shell integration — auto-generated, do not edit
# Source user's .zshrc first
[[ -f "\${BRAID_USER_ZDOTDIR:-\$HOME}/.zshrc" ]] && builtin source "\${BRAID_USER_ZDOTDIR:-\$HOME}/.zshrc"

# ── Braid command tracking hooks (added AFTER user's .zshrc) ──
# precmd fires after each command finishes (before prompt is drawn).
# preexec fires just before a command runs.
# OSC 633;D;<exitcode> = command finished. OSC 633;C = command starting.
__braid_precmd() { builtin printf '\\e]633;D;%d\\a' "\$?"; }
__braid_preexec() { builtin printf '\\e]633;C\\a'; }
precmd_functions+=(__braid_precmd)
preexec_functions+=(__braid_preexec)

# Restore ZDOTDIR so the shell behaves normally after startup
ZDOTDIR="\${BRAID_USER_ZDOTDIR:-\$HOME}"
`)

  writeFileSync(join(ZSH_DIR, '.zlogin'), `\
# Braid shell integration — auto-generated, do not edit
[[ -f "\${BRAID_USER_ZDOTDIR:-\$HOME}/.zlogin" ]] && builtin source "\${BRAID_USER_ZDOTDIR:-\$HOME}/.zlogin"
`)

  // ── bash ───────────────────────────────────────────────────────────────────
  writeFileSync(BASH_INIT, `\
# Braid shell integration — auto-generated, do not edit
__braid_precmd() {
  local ec=\$?
  builtin printf '\\e]633;D;%d\\a' "\$ec"
  return \$ec
}
if [[ -n "\$PROMPT_COMMAND" ]]; then
  PROMPT_COMMAND="__braid_precmd;\$PROMPT_COMMAND"
else
  PROMPT_COMMAND="__braid_precmd"
fi
trap 'builtin printf "\\e]633;C\\a"' DEBUG
`)
}

/** Returns env overrides to inject shell integration for the given shell. */
export function getShellIntegrationEnv(shell: string): Record<string, string> {
  ensureShellIntegration()

  if (shell.endsWith('zsh')) {
    return {
      BRAID_USER_ZDOTDIR: process.env.ZDOTDIR || process.env.HOME || homedir(),
      ZDOTDIR: ZSH_DIR
    }
  }

  if (shell.endsWith('bash') || shell.endsWith('sh')) {
    return {
      BASH_ENV: BASH_INIT
    }
  }

  return {}
}

// ─── OSC 633 parsing ────────────────────────────────────────────────────────

// Matches OSC 633;D;<exitcode> (command completed) — \x1b]633;D;N\x07 or \x1b]633;D;N\x1b\\
const OSC_633_D = /\x1b\]633;D;(\d*)\x07|\x1b\]633;D;(\d*)\x1b\\/

/** Check PTY output for OSC 633;D (command completed).
 *  Returns the exit code if found, or null if not present. */
export function parseCommandCompleted(data: string): number | null {
  const match = data.match(OSC_633_D)
  if (!match) return null
  const code = match[1] ?? match[2] ?? '0'
  return parseInt(code, 10)
}

/** Strip Braid shell integration OSC 633 sequences from output. */
export function stripShellIntegration(data: string): string {
  return data.replace(/\x1b\]633;[^\x07]*(?:\x07|\x1b\\)/g, '')
}
