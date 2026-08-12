// ─── Analytics ───────────────────────────────────────────────────────────────
//
// Opt-in only. `initAnalytics()` asks main whether the user has set
// `telemetryEnabled: true` in ~/.braid/config.json (default false) and does
// nothing otherwise — PostHog is never initialised, so no identifier is
// generated and no request leaves the machine.
//
// Every other function here is a no-op until init has actually run. They are
// called from all over the app and must never be the thing that wakes the SDK
// up: `initialized` is the single gate, and only initAnalytics can set it.

import posthog from 'posthog-js'
import { ipc } from './ipc'

const POSTHOG_KEY = 'phc_uuXyzP4CUbkWGHxVu5bETfaZnkNuySWkG2U6YmvArcbv'
const POSTHOG_HOST = 'https://us.i.posthog.com'

let initialized = false

export async function initAnalytics(): Promise<void> {
  if (initialized) return

  let enabled = false
  try {
    enabled = await ipc.telemetry.isEnabled()
  } catch (err) {
    // Consent unknown means no consent — stay off rather than guess.
    console.error('[analytics] could not read telemetry setting — staying disabled', err)
    return
  }
  if (!enabled) return

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true
  })
  initialized = true
}

export function identifyUser(userId: string, properties?: Record<string, unknown>): void {
  if (!initialized) return
  posthog.identify(userId, properties)
}

export function track(event: string, properties?: Record<string, unknown>): void {
  if (!initialized) return
  posthog.capture(event, properties)
}

export function resetAnalytics(): void {
  if (!initialized) return
  posthog.reset()
}
