// ─── API Client ──────────────────────────────────────────────────────────────
//
// Thin axios wrapper for core-api. Auto-attaches JWT, handles silent token
// refresh on 401 responses, and normalises error responses into Error objects
// with a `.code` property for structured error handling.
//
// On 401: attempts one silent refresh via getUser(), queues concurrent requests
// during refresh, retries the original request. Only pushes AUTH_CHANGED (logout)
// if the refresh token itself is rejected by the auth server.

import axios from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'
import { getAccessToken, getUser } from '../services/auth'
import { getConfig, getServerUrl } from './app-mode'
import { getLocalUser } from './local-user'

// There is no default server. Team mode points at whatever the user self-hosts,
// read from ~/.braid/config.json; in local mode nothing here is ever called,
// because the capability registry gates every server-backed path first.
//
// baseURL stays empty when unset rather than falling back to some address: a
// silent default would send a self-hoster's data somewhere they never chose.
const serverUrl = getServerUrl()

export const apiClient = axios.create({
  baseURL: serverUrl ? `${serverUrl.replace(/\/+$/, '')}/v1` : undefined,
  timeout: 30_000
})

// ─── Request: attach credentials ─────────────────────────────────────────────
//
// Two shapes, matching the server's two AUTH_MODEs:
//
//   shared token — the bearer is the server's AUTH_TOKEN and the caller states
//     who they are in x-user-email / x-user-name. The server trusts those
//     headers; identity is self-asserted, which is why this is documented as
//     trusted-network-only. We send the same git identity used everywhere else,
//     so authorship is consistent whichever mode a workspace was created in.
//
//   OIDC — the bearer is a real JWT and identity comes from its verified
//     claims, so no identity headers are sent (the server would ignore them).
//
// Which one applies is decided by whether a serverToken is configured, not by a
// separate mode flag: one setting, no way for the two to disagree.

apiClient.interceptors.request.use(async (config) => {
  const { serverToken } = getConfig()

  if (serverToken) {
    const user = getLocalUser()
    config.headers.Authorization = `Bearer ${serverToken}`
    config.headers['x-user-email'] = user.email
    if (user.displayName) config.headers['x-user-name'] = user.displayName
    return config
  }

  // getUser() refreshes the token if it's near expiry, ensuring we always
  // send a valid JWT. getAccessToken() then reads the (possibly refreshed) token.
  await getUser()
  const token = getAccessToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// ─── Response: 401 refresh + retry ──────────────────────────────────────────
// Standard pattern: on 401, attempt one refresh. While refreshing, queue all
// other failing requests and resolve them once the new token is available.

let isRefreshing = false
let refreshQueue: Array<{
  resolve: (token: string | null) => void
  reject: (err: unknown) => void
}> = []

function processQueue(token: string | null, error: unknown = null): void {
  for (const { resolve, reject } of refreshQueue) {
    if (error) reject(error)
    else resolve(token)
  }
  refreshQueue = []
}

export interface ApiError extends Error {
  code: string
  status: number
}

// Callback set by main process to push auth changes to renderer.
// Set via setAuthChangePush() after the BrowserWindow is created.
let pushAuthChange: ((user: null) => void) | null = null

export function setAuthChangePush(fn: (user: null) => void): void {
  pushAuthChange = fn
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    // Only handle 401 responses (not network errors, not already retried)
    if (!axios.isAxiosError(error) || error.response?.status !== 401 || originalRequest._retry) {
      // Normalise non-401 errors with code property
      if (axios.isAxiosError(error) && error.response?.data?.code) {
        const { code, message } = error.response.data as { code: string; message: string }
        const apiError = new Error(message) as ApiError
        apiError.code = code
        apiError.status = error.response.status
        throw apiError
      }
      throw error
    }

    // Shared-token mode has no session and nothing to refresh. A 401 here means
    // the token is wrong or the server's AUTH_TOKEN changed — a configuration
    // problem the user must fix in Settings. Running the refresh path would
    // push a spurious "signed out" and hide the real cause.
    if (getConfig().serverToken) {
      const data = error.response?.data as { code?: string; message?: string } | undefined
      const apiError = new Error(
        data?.message ?? 'Server rejected the token. Check the server URL and token in Settings.'
      ) as ApiError
      apiError.code = data?.code ?? 'SERVER_TOKEN_REJECTED'
      apiError.status = 401
      throw apiError
    }

    // Mark as retried to prevent infinite loops
    originalRequest._retry = true

    if (isRefreshing) {
      // Another request is already refreshing — queue this one
      return new Promise((resolve, reject) => {
        refreshQueue.push({
          resolve: (token) => {
            if (token) {
              originalRequest.headers.Authorization = `Bearer ${token}`
            }
            resolve(apiClient(originalRequest))
          },
          reject
        })
      })
    }

    isRefreshing = true

    try {
      const user = await getUser()
      const newToken = getAccessToken()

      if (user && newToken) {
        // Refresh succeeded — retry original + release queue
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        processQueue(newToken)
        return apiClient(originalRequest)
      }

      // getUser() returned null — refresh token was rejected (not a network error,
      // because getUser() now preserves session on network errors).
      // This means the user must re-authenticate.
      processQueue(null, new Error('Session expired'))
      if (pushAuthChange) pushAuthChange(null)
      throw error
    } catch (refreshError) {
      processQueue(null, refreshError)
      throw refreshError
    } finally {
      isRefreshing = false
    }
  }
)
