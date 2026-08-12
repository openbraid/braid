// ─── Capabilities ────────────────────────────────────────────────────────────
//
// One source of truth for which features are available right now. The renderer
// never asks "what mode are we in" — it asks "can I do X", and gets back a
// reason it can render verbatim in a tooltip.
//
// Adding a feature that needs a server means adding one entry here. It must
// never mean scattering `if (mode === 'team')` checks through components.
//
// Three distinct states matter, and collapsing them produces bad UX:
//   local mode          — the feature needs a server and none is configured
//   team mode, offline  — a server is configured but unreachable right now
//   team mode, online   — available

import { Capability, type CapabilityMap, type CapabilityState } from '../../../shared/ipc-types'
import { getConfig, isLocalMode } from '../../lib/app-mode'

/** Server-backed features. Everything not listed here is always available. */
const SERVER_BACKED: readonly Capability[] = [
  Capability.Invites,
  Capability.Comments,
  Capability.LiveEditing,
  Capability.Presence,
  Capability.SharedArtifacts,
  Capability.NameSuggestion
] as const

const REASON_LOCAL = 'Available in team mode. Connect a server in Settings to enable.'
const REASON_OFFLINE = 'Cannot reach the server. Check your connection and try again.'

// Updated by the server health check; meaningless in local mode.
let serverReachable = true

export function setServerReachable(reachable: boolean): void {
  serverReachable = reachable
}

export function getCapabilities(): CapabilityMap {
  const local = isLocalMode()
  const available = !local && serverReachable

  const state: CapabilityState = available
    ? { enabled: true, reason: null }
    : { enabled: false, reason: local ? REASON_LOCAL : REASON_OFFLINE }

  const map = {} as CapabilityMap
  for (const capability of Object.values(Capability)) {
    map[capability] = SERVER_BACKED.includes(capability) ? state : { enabled: true, reason: null }
  }
  return map
}

export function isCapabilityEnabled(capability: Capability): boolean {
  return getCapabilities()[capability].enabled
}

/**
 * Throws a structured error when a server-backed path is reached without a
 * server. IPC handlers call this instead of letting an axios failure surface
 * as an unhelpful network error.
 */
export function assertCapability(capability: Capability): void {
  const state = getCapabilities()[capability]
  if (state.enabled) return

  const err = new Error(state.reason ?? 'This feature is unavailable') as Error & { code: string }
  err.code = 'CAPABILITY_UNAVAILABLE'
  throw err
}

/** Exposed so the renderer can show which server it is pointed at. */
export function getServerUrl(): string | null {
  return getConfig().serverUrl
}
