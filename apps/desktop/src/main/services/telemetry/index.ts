// ─── Telemetry ───────────────────────────────────────────────────────────────
//
// Owns the single question the renderer is allowed to ask about analytics:
// "may I send anything at all?".
//
// Consent is opt-in and lives in ~/.braid/config.json (`telemetryEnabled`),
// which defaults to false. Nothing phones home in local mode, so the analytics
// SDK in the renderer is never loaded or initialised unless this returns true —
// gating individual events would still hand PostHog an install identifier at
// init time, which is exactly what opt-in must prevent.

import { getConfig } from '../../lib/app-mode'

export function isTelemetryEnabled(): boolean {
  return getConfig().telemetryEnabled
}
