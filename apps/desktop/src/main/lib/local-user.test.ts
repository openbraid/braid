import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Local user identity ─────────────────────────────────────────────────────
//
// `execFileSync` is mocked outright: these tests must never shell out to the
// real `git`, which would read the developer's global git config and make the
// derived IDs machine-dependent. The mock also lets us simulate git being
// absent, which is otherwise unreproducible on a dev machine.
const git = vi.hoisted(() => ({
  /** Key → value, or `null` for "not set". A missing key throws, like real git. */
  config: new Map<string, string | null>(),
  /** When set, every invocation throws — git not on PATH. */
  unavailable: false
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFileSync: (file: string, args: readonly string[]): string => {
      if (git.unavailable) throw new Error('spawnSync git ENOENT')
      // Mirrors `git config --get <key>`: exit code 1 (a throw here) when unset.
      const key = args[args.length - 1]
      const value = git.config.get(key)
      if (value === undefined) throw new Error(`git ${file} exited with code 1`)
      return value === null ? '\n' : `${value}\n`
    }
  }
})

type LocalUserModule = typeof import('./local-user')

/** The resolved identity is cached at module scope — reset it per test. */
async function freshModule(): Promise<LocalUserModule> {
  vi.resetModules()
  return import('./local-user')
}

describe('local-user', () => {
  beforeEach(() => {
    git.config = new Map()
    git.unavailable = false
  })

  describe('getLocalUser', () => {
    it('derives the identity from git config user.name and user.email', async () => {
      git.config.set('user.name', 'Ada Lovelace')
      git.config.set('user.email', 'ada@example.com')
      const { getLocalUser } = await freshModule()

      expect(getLocalUser()).toEqual({
        id: expect.any(String),
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        displayName: 'Ada Lovelace'
      })
    })

    it('treats everything after the first space as the last name', async () => {
      git.config.set('user.name', 'Ada King Lovelace')
      git.config.set('user.email', 'ada@example.com')
      const { getLocalUser } = await freshModule()

      const user = getLocalUser()
      expect(user.firstName).toBe('Ada')
      expect(user.lastName).toBe('King Lovelace')
    })

    it('leaves lastName null for a single-word name', async () => {
      git.config.set('user.name', 'Madonna')
      git.config.set('user.email', 'madonna@example.com')
      const { getLocalUser } = await freshModule()

      const user = getLocalUser()
      expect(user.firstName).toBe('Madonna')
      expect(user.lastName).toBeNull()
      expect(user.displayName).toBe('Madonna')
    })

    it('collapses runs of whitespace when splitting the name', async () => {
      git.config.set('user.name', '  Ada   Lovelace  ')
      git.config.set('user.email', 'ada@example.com')
      const { getLocalUser } = await freshModule()

      const user = getLocalUser()
      expect(user.firstName).toBe('Ada')
      expect(user.lastName).toBe('Lovelace')
      // NOTE: displayName is the raw git value, so trailing whitespace inside
      // the configured name survives into the UI. Only the trailing newline that
      // git appends is stripped.
      expect(user.displayName).toBe('Ada   Lovelace')
    })

    it('falls back to you@localhost when user.email is unset', async () => {
      git.config.set('user.name', 'Ada Lovelace')
      const { getLocalUser } = await freshModule()

      expect(getLocalUser().email).toBe('you@localhost')
    })

    it('uses the email as displayName when user.name is unset', async () => {
      git.config.set('user.email', 'ada@example.com')
      const { getLocalUser } = await freshModule()

      expect(getLocalUser()).toMatchObject({
        email: 'ada@example.com',
        firstName: null,
        lastName: null,
        displayName: 'ada@example.com'
      })
    })

    it('treats an empty git config value as unset', async () => {
      git.config.set('user.name', null)
      git.config.set('user.email', null)
      const { getLocalUser } = await freshModule()

      expect(getLocalUser()).toMatchObject({
        email: 'you@localhost',
        firstName: null,
        lastName: null,
        displayName: 'you@localhost'
      })
    })

    it('produces a complete fallback identity when git is unavailable', async () => {
      git.unavailable = true
      const { getLocalUser } = await freshModule()

      expect(getLocalUser()).toMatchObject({
        email: 'you@localhost',
        firstName: null,
        lastName: null,
        displayName: 'you@localhost'
      })
    })

    it('caches the identity so later git config changes are ignored', async () => {
      git.config.set('user.email', 'ada@example.com')
      const { getLocalUser } = await freshModule()

      const first = getLocalUser()
      git.config.set('user.email', 'someone.else@example.com')

      expect(getLocalUser()).toBe(first)
    })
  })

  describe('derived id', () => {
    it('is stable across restarts for the same email', async () => {
      git.config.set('user.email', 'ada@example.com')
      const a = (await freshModule()).getLocalUser().id
      const b = (await freshModule()).getLocalUser().id

      expect(a).toBe(b)
    })

    it('is case-insensitive in the email', async () => {
      git.config.set('user.email', 'Ada@Example.COM')
      const upper = (await freshModule()).getLocalUser().id

      git.config.set('user.email', 'ada@example.com')
      const lower = (await freshModule()).getLocalUser().id

      expect(upper).toBe(lower)
    })

    it('differs for different emails', async () => {
      git.config.set('user.email', 'ada@example.com')
      const a = (await freshModule()).getLocalUser().id

      git.config.set('user.email', 'grace@example.com')
      const b = (await freshModule()).getLocalUser().id

      expect(a).not.toBe(b)
    })

    it('is UUID-shaped so it can be stored in the same columns as server IDs', async () => {
      git.config.set('user.email', 'ada@example.com')
      const { getLocalUser } = await freshModule()

      expect(getLocalUser().id).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/)
    })

    it('does not depend on the configured name', async () => {
      git.config.set('user.email', 'ada@example.com')
      git.config.set('user.name', 'Ada Lovelace')
      const withName = (await freshModule()).getLocalUser().id

      git.config.delete('user.name')
      const withoutName = (await freshModule()).getLocalUser().id

      expect(withName).toBe(withoutName)
    })
  })

  describe('hasGitIdentity', () => {
    it('is true when both name and email are configured', async () => {
      git.config.set('user.name', 'Ada Lovelace')
      git.config.set('user.email', 'ada@example.com')
      const { hasGitIdentity } = await freshModule()

      expect(hasGitIdentity()).toBe(true)
    })

    it('is false when only the email is configured', async () => {
      git.config.set('user.email', 'ada@example.com')
      const { hasGitIdentity } = await freshModule()

      expect(hasGitIdentity()).toBe(false)
    })

    it('is false when only the name is configured', async () => {
      git.config.set('user.name', 'Ada Lovelace')
      const { hasGitIdentity } = await freshModule()

      expect(hasGitIdentity()).toBe(false)
    })

    it('is false when git is unavailable', async () => {
      git.unavailable = true
      const { hasGitIdentity } = await freshModule()

      expect(hasGitIdentity()).toBe(false)
    })

    it('reads git live rather than the cached identity', async () => {
      // The UI polls this to decide whether to prompt for a name, so it has to
      // notice the user fixing their git config without an app restart.
      const { hasGitIdentity } = await freshModule()
      expect(hasGitIdentity()).toBe(false)

      git.config.set('user.name', 'Ada Lovelace')
      git.config.set('user.email', 'ada@example.com')
      expect(hasGitIdentity()).toBe(true)
    })
  })
})
