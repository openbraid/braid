import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { formatRelativeTime } from './format'

// ─── Relative time formatting ────────────────────────────────────────────────
//
// The function reads `Date.now()` directly, so the clock is frozen for every
// test. Without that, a test asserting the 60-second boundary is a coin flip
// depending on how long the suite took to reach it.

const NOW = new Date('2026-06-15T12:00:00.000Z').getTime()

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Timestamp for "this long ago", expressed against the frozen clock. */
function ago(ms: number): number {
  return NOW - ms
}

describe('formatRelativeTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('absent values', () => {
    it('returns Never for null', () => {
      expect(formatRelativeTime(null)).toBe('Never')
    })

    it('returns Never for 0', () => {
      // 0 is the Unix epoch, but in this codebase it only ever means "unset" —
      // the guard is a falsy check, so epoch timestamps are unrepresentable.
      expect(formatRelativeTime(0)).toBe('Never')
    })

    it('returns Never for NaN', () => {
      // NaN is falsy, so it short-circuits before any arithmetic could produce
      // the string "NaNm ago".
      expect(formatRelativeTime(NaN)).toBe('Never')
    })
  })

  describe('seconds', () => {
    it('reports Just now for the current instant', () => {
      expect(formatRelativeTime(NOW)).toBe('Just now')
    })

    it('reports Just now just under a minute', () => {
      expect(formatRelativeTime(ago(59 * SECOND))).toBe('Just now')
      expect(formatRelativeTime(ago(MINUTE - 1))).toBe('Just now')
    })
  })

  describe('minutes', () => {
    it('switches to minutes exactly at 60 seconds', () => {
      expect(formatRelativeTime(ago(MINUTE))).toBe('1m ago')
    })

    it('truncates rather than rounds', () => {
      expect(formatRelativeTime(ago(119 * SECOND))).toBe('1m ago')
    })

    it('holds minutes up to the last one before an hour', () => {
      expect(formatRelativeTime(ago(59 * MINUTE))).toBe('59m ago')
      expect(formatRelativeTime(ago(HOUR - 1))).toBe('59m ago')
    })
  })

  describe('hours', () => {
    it('switches to hours exactly at 60 minutes', () => {
      expect(formatRelativeTime(ago(HOUR))).toBe('1h ago')
    })

    it('holds hours up to the last one before a day', () => {
      expect(formatRelativeTime(ago(23 * HOUR))).toBe('23h ago')
      expect(formatRelativeTime(ago(DAY - 1))).toBe('23h ago')
    })
  })

  describe('days', () => {
    it('switches to days exactly at 24 hours', () => {
      expect(formatRelativeTime(ago(DAY))).toBe('1d ago')
    })

    it('holds days up to 29', () => {
      expect(formatRelativeTime(ago(29 * DAY))).toBe('29d ago')
      expect(formatRelativeTime(ago(30 * DAY - 1))).toBe('29d ago')
    })
  })

  describe('months', () => {
    it('switches to months at 30 days', () => {
      // A month is a flat 30 days here — deliberately approximate, since the
      // string is a glanceable summary rather than a calendar calculation.
      expect(formatRelativeTime(ago(30 * DAY))).toBe('1mo ago')
    })

    it('holds months up to 11', () => {
      expect(formatRelativeTime(ago(359 * DAY))).toBe('11mo ago')
    })
  })

  describe('years', () => {
    it('switches to years at 12 thirty-day months, i.e. 360 days', () => {
      expect(formatRelativeTime(ago(360 * DAY))).toBe('1y ago')
    })

    it('still reads 1y at a real calendar year', () => {
      expect(formatRelativeTime(ago(365 * DAY))).toBe('1y ago')
    })

    it('scales to multiple years', () => {
      expect(formatRelativeTime(ago(3 * 360 * DAY))).toBe('3y ago')
    })

    it('handles a very large age without overflowing the format', () => {
      expect(formatRelativeTime(1)).toMatch(/^\d+y ago$/)
    })
  })

  describe('out-of-range values', () => {
    it('reports future timestamps as Just now', () => {
      // Clock skew between a server row and this machine is common; a negative
      // elapsed time falls through the first branch rather than printing
      // "-5m ago".
      expect(formatRelativeTime(NOW + HOUR)).toBe('Just now')
    })

    it('reports pre-epoch (negative) timestamps as years ago', () => {
      // Negative is truthy, so it is formatted rather than treated as unset —
      // an inconsistency with 0, which is treated as unset.
      expect(formatRelativeTime(-DAY)).toMatch(/^\d+y ago$/)
    })
  })
})
