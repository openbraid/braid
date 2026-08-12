// ─── Local user identity ─────────────────────────────────────────────────────
//
// In local mode there is no account and no identity provider. Identity comes
// from git config — the same name and email that already goes into every commit
// the user makes. Nothing to sign up for, nothing to configure.
//
// The user ID is derived deterministically from the email so that rows written
// today still resolve to the same user after a restart, and so a local project
// can later be pushed to a server without rewriting authorship.

import { execFileSync } from 'child_process'
import { createHash } from 'crypto'

export type LocalUser = {
  id: string
  email: string
  firstName: string | null
  lastName: string | null
  displayName: string
}

let cached: LocalUser | null = null

function gitConfig(key: string): string | null {
  try {
    const value = execFileSync('git', ['config', '--get', key], {
      encoding: 'utf-8',
      timeout: 2000
    }).trim()
    return value || null
  } catch {
    // git missing, or the key is not set — both are non-fatal
    return null
  }
}

/** UUID v5-shaped ID derived from the email, so it is stable across restarts. */
function deriveId(email: string): string {
  const h = createHash('sha256').update(`local-user:${email.toLowerCase()}`).digest('hex')
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join(
    '-'
  )
}

export function getLocalUser(): LocalUser {
  if (cached) return cached

  const email = gitConfig('user.email') ?? 'you@localhost'
  const name = gitConfig('user.name')

  const [firstName, ...rest] = (name ?? '').split(' ').filter(Boolean)
  const lastName = rest.length > 0 ? rest.join(' ') : null

  cached = {
    id: deriveId(email),
    email,
    firstName: firstName ?? null,
    lastName,
    displayName: name ?? email
  }

  return cached
}

/** True when git has no user.name configured — the UI can prompt to set one. */
export function hasGitIdentity(): boolean {
  return gitConfig('user.name') !== null && gitConfig('user.email') !== null
}
