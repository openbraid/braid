import { safeStorage } from 'electron'
import { createWorkOS } from '@workos-inc/node'
import ElectronStore from 'electron-store'
import { getConfig, isLocalMode } from '../../lib/app-mode'
import { getLocalUser } from '../../lib/local-user'

// electron-store v10 exports { default, __esModule } — handle both bundler behaviors
const Store = ('default' in ElectronStore ? ElectronStore.default : ElectronStore) as typeof ElectronStore

const CLIENT_ID = import.meta.env.MAIN_VITE_WORKOS_CLIENT_ID
const REDIRECT_URI = 'braid://auth/callback'
const PKCE_TTL_MS = 10 * 60 * 1000 // 10 minutes
let lastProvider: AuthProvider = 'authkit'

export type AuthProvider = 'GoogleOAuth' | 'GitHubOAuth' | 'authkit'

export type AuthUser = {
  id: string
  backendUserId: string | null
  email: string
  firstName: string | null
  lastName: string | null
  profilePictureUrl: string | null
}

type SessionData = { accessToken: string; refreshToken: string; user: AuthUser }

interface StoreSchema {
  // Session is encrypted via safeStorage — stored as base64 ciphertext.
  // safeStorage uses OS Keychain (macOS) / DPAPI (Windows) — key is stable
  // across launches and managed by the OS, not by us.
  sessionEncrypted: string | null
  pkce: { codeVerifier: string; expiresAt: number } | null
}

// Constructed lazily: a fresh local-mode clone has no WORKOS_CLIENT_ID, and
// creating the client eagerly would throw at import time and take the app down
// before it ever reaches the local code path.
function createClient() {
  if (!CLIENT_ID) {
    throw new Error(
      'WORKOS_CLIENT_ID is not set. Sign-in requires team mode with an OIDC-configured server.'
    )
  }
  return createWorkOS({ clientId: CLIENT_ID })
}

let workosClient: ReturnType<typeof createClient> | null = null

function getWorkOS(): ReturnType<typeof createClient> {
  if (!workosClient) workosClient = createClient()
  return workosClient
}

// No encryptionKey — we handle encryption ourselves via safeStorage
const store = new Store<StoreSchema>({
  name: 'braid-auth-session',
  defaults: { sessionEncrypted: null, pkce: null }
})

// ─── Session encryption helpers ──────────────────────────────────────────────

const canEncrypt = safeStorage.isEncryptionAvailable()

function saveSession(session: SessionData): void {
  const json = JSON.stringify(session)
  if (canEncrypt) {
    store.set('sessionEncrypted', safeStorage.encryptString(json).toString('base64'))
  } else {
    // Fallback: store unencrypted (dev on unsupported platform)
    store.set('sessionEncrypted', Buffer.from(json).toString('base64'))
  }
}

function loadSession(): SessionData | null {
  const blob = store.get('sessionEncrypted')
  if (!blob) return null

  try {
    const buffer = Buffer.from(blob, 'base64')
    const json = canEncrypt
      ? safeStorage.decryptString(buffer)
      : buffer.toString('utf-8')
    return JSON.parse(json) as SessionData
  } catch {
    // Corrupt or re-encrypted with different key — clear it
    store.delete('sessionEncrypted')
    return null
  }
}

function deleteSession(): void {
  store.delete('sessionEncrypted')
}

// ─── Error classification ────────────────────────────────────────────────────

/** Returns true if the error is a transient network issue (not an auth rejection). */
function isTransientError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as Record<string, unknown>

  // Axios-style network errors (no response from server)
  if (e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' || e.code === 'ENOTFOUND' ||
      e.code === 'ETIMEDOUT' || e.code === 'ERR_NETWORK' || e.code === 'ECONNABORTED') {
    return true
  }

  // fetch/undici style
  if (e.cause && typeof e.cause === 'object') {
    const cause = e.cause as Record<string, unknown>
    if (cause.code === 'ECONNREFUSED' || cause.code === 'ENOTFOUND' || cause.code === 'ETIMEDOUT') {
      return true
    }
  }

  // No HTTP response at all (network layer failure)
  if ('request' in e && !('response' in e)) return true

  // Generic fetch failure message
  const msg = (e.message as string | undefined)?.toLowerCase() ?? ''
  if (msg.includes('network') || msg.includes('fetch failed') || msg.includes('socket hang up')) {
    return true
  }

  return false
}

// ─── Local mode identity ─────────────────────────────────────────────────────

/**
 * The synthetic user for local mode. Shaped exactly like a WorkOS-backed
 * AuthUser so every caller downstream is unaware of which mode it is in.
 */
function getLocalAuthUser(): AuthUser {
  const user = getLocalUser()
  return {
    id: user.id,
    backendUserId: null,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    profilePictureUrl: null
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Get the provider used for the most recent sign-in attempt */
export function getLastProvider(): string {
  return lastProvider
}

/** Generate sign-in URL with PKCE challenge for a specific provider */
export async function getSignInUrl(provider: AuthProvider): Promise<string> {
  lastProvider = provider
  const { codeVerifier, codeChallenge } = await getWorkOS().pkce.generate()
  store.set('pkce', { codeVerifier, expiresAt: Date.now() + PKCE_TTL_MS })

  return getWorkOS().userManagement.getAuthorizationUrl({
    redirectUri: REDIRECT_URI,
    codeChallenge,
    codeChallengeMethod: 'S256',
    provider
  })
}

/** Exchange authorization code for tokens */
export async function handleCallback(code: string): Promise<AuthUser> {
  const pkce = store.get('pkce')
  if (!pkce) throw new Error('No PKCE state found')
  if (pkce.expiresAt < Date.now()) {
    store.delete('pkce')
    throw new Error('PKCE expired — please try signing in again')
  }

  const auth = await getWorkOS().userManagement.authenticateWithCode({
    code,
    codeVerifier: pkce.codeVerifier
  })

  store.delete('pkce')

  const session: SessionData = {
    accessToken: auth.accessToken,
    refreshToken: auth.refreshToken,
    user: {
      id: auth.user.id,
      backendUserId: null,
      email: auth.user.email,
      firstName: auth.user.firstName,
      lastName: auth.user.lastName,
      profilePictureUrl: auth.user.profilePictureUrl
    }
  }
  saveSession(session)

  return session.user
}

function parseJwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString())
}

/** Get current user, refreshing token if expired */
export async function getUser(): Promise<AuthUser | null> {
  // Two of the three configurations have no sign-in step at all:
  //
  //   local        — no server, no accounts.
  //   shared token — the server authenticates the *client* with one secret and
  //                  takes identity from headers we send.
  //
  // Both take identity from git config, so there is always a user and the login
  // screen must never appear. Only OIDC has an actual sign-in, and that is the
  // only case that falls through to the session below.
  if (isLocalMode() || getConfig().serverToken) return getLocalAuthUser()

  const session = loadSession()
  if (!session?.accessToken) return null

  const { exp } = parseJwtPayload(session.accessToken) as { exp: number }
  const tokenExpired = Date.now() > exp * 1000 - 10_000 // 10s buffer

  if (tokenExpired) {
    try {
      const refreshed = await getWorkOS().userManagement.authenticateWithRefreshToken({
        clientId: CLIENT_ID,
        refreshToken: session.refreshToken
      })
      const newSession: SessionData = {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        user: {
          id: refreshed.user.id,
          backendUserId: session.user.backendUserId,
          email: refreshed.user.email,
          firstName: refreshed.user.firstName,
          lastName: refreshed.user.lastName,
          profilePictureUrl: refreshed.user.profilePictureUrl
        }
      }
      saveSession(newSession)
      return newSession.user
    } catch (err: unknown) {
      // Distinguish network errors (transient) from auth rejection (permanent).
      // Only clear session if WorkOS explicitly rejected the refresh token.
      // Network errors (timeout, DNS, etc.) should keep the session intact
      // so the next attempt can retry when connectivity is restored.
      const isNetworkError = isTransientError(err)
      if (isNetworkError) {
        console.warn('[auth] Token refresh failed due to network error — keeping session intact')
        return session.user // Return stale user; token is expired but session preserved
      }
      console.warn('[auth] Token refresh rejected by auth server — clearing session')
      deleteSession()
      return null
    }
  }

  return session.user
}

/** Get the stored access token (for API calls to core-api) */
export function getAccessToken(): string | null {
  // In shared-token mode the credential IS the configured token — there is no
  // JWT. Callers that need a bearer for a non-axios path (the collaboration
  // WebSocket) must get the same value the request interceptor sends.
  const { serverToken } = getConfig()
  if (serverToken) return serverToken

  const session = loadSession()
  return session?.accessToken ?? null
}

/** Clear local session */
export function clearSession(): void {
  deleteSession()
  store.delete('pkce')
}

/** Get session ID from stored access token (needed for logout URL) */
export function getSessionId(): string | null {
  const session = loadSession()
  if (!session?.accessToken) return null
  try {
    const { sid } = parseJwtPayload(session.accessToken) as { sid?: string }
    return sid ?? null
  } catch {
    return null
  }
}

/** Get WorkOS logout URL */
export function getLogoutUrl(sessionId: string): string {
  return `https://api.workos.com/user_management/sessions/logout?session_id=${sessionId}`
}

/** Get the authentication method from the stored session (for backend provisioning) */
export function getAuthMethod(): string | null {
  const session = loadSession()
  if (!session?.accessToken) return null
  try {
    const payload = parseJwtPayload(session.accessToken)
    return (payload.login_method as string) ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Provision user in backend after login. Returns true on success. */
export async function provisionUserInBackend(provider: string): Promise<boolean> {
  const token = getAccessToken()
  const session = loadSession()
  if (!token || !session?.user) return false

  const { email, firstName, lastName, profilePictureUrl } = session.user

  try {
    // Import apiClient lazily to avoid circular dependency (api-client imports from auth)
    const { apiClient } = await import('../../lib/api-client')
    const { data } = await apiClient.post('/users/me', { provider, email, firstName, lastName, picture: profilePictureUrl })

    // Store the backend internal user ID in the session
    if (data?.id) {
      session.user.backendUserId = data.id
      saveSession(session)
    }

    return true
  } catch (err) {
    console.error('[auth] Backend user provisioning failed:', err)
    return false
  }
}
