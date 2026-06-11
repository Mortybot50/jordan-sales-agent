/**
 * _shared/send-window.ts — pure scheduling helpers for the send pipeline.
 *
 * Extracted from enqueue-sends 11/06/2026 so the working-window and pacing
 * maths can be unit-tested outside the Deno runtime (vitest imports this file
 * directly — keep it free of Deno globals and https imports).
 *
 * These functions decide WHEN a cold email is allowed to leave the queue.
 * A bug here sends at 3am or busts the daily cap — treat as send-safety code.
 */

export const MIN_INBOX_GAP_SECONDS = 90

// Return the current hour (0..23) in the given IANA timezone.
export function currentHourInTz(tz: string, now: Date = new Date()): number {
  try {
    const fmt = new Intl.DateTimeFormat('en-AU', {
      hour: 'numeric', hour12: false, timeZone: tz,
    })
    const parts = fmt.formatToParts(now)
    const h = parts.find((p) => p.type === 'hour')?.value ?? '0'
    return parseInt(h, 10) % 24  // some locales emit '24' for midnight
  } catch {
    return now.getUTCHours()
  }
}

// Day-start (midnight) in the given IANA timezone, as a UTC Date. Used so
// daily_send_cap counts calendar days in the user's tz, not trailing-24h-UTC
// sliding windows. Pre per-tz fix, a user in Melbourne who burned half their
// cap at 11pm could send the other half at 12:30am, then a fresh allocation
// from "midnight Melbourne" — total well above the cap for the operator-facing
// day. Closes audit P1-CP-01.
export function dayStartInTz(now: Date, tz: string): Date {
  // Format `now` as YYYY-MM-DD in the tz. en-CA gives ISO-style YYYY-MM-DD.
  const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now)
  // Resolve the tz offset at `now` so we can build a stable ISO timestamp.
  // `longOffset` is supported in V8 (Node 20+, Deno) and emits e.g. "GMT+10:00".
  const offParts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(now)
  const rawOff = offParts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+00:00'
  const off = rawOff.replace(/^GMT/, '') || '+00:00'
  return new Date(`${dateStr}T00:00:00${off}`)
}

// Push `from` forward into the next [startHourLocal, endHourLocal) window in tz.
// If `from` is already inside the window, return `from`.
export function clampToWorkingWindow(from: Date, tz: string, startHourLocal: number, endHourLocal: number): Date {
  const h = currentHourInTz(tz, from)
  if (h >= startHourLocal && h < endHourLocal) return from

  // Push forward by 1 hour at a time until we land inside the window.
  // Bounded loop — never more than 24 iterations.
  let candidate = new Date(from.getTime())
  for (let i = 0; i < 48; i++) {
    candidate = new Date(candidate.getTime() + 60 * 60 * 1000)
    const ch = currentHourInTz(tz, candidate)
    if (ch === startHourLocal) {
      // Snap to top of the start-hour by zeroing the minutes/seconds in local TZ.
      // We can't easily set local minutes from Deno; instead, walk back to the
      // first minute of the start-hour by stepping forward in 1-min until the
      // 'minute' part is 0..2 (close enough for a pacing scheduler).
      for (let j = 0; j < 60; j++) {
        const m = parseInt(
          new Intl.DateTimeFormat('en-AU', { minute: 'numeric', timeZone: tz })
            .formatToParts(candidate)
            .find((p) => p.type === 'minute')?.value ?? '0',
          10,
        )
        if (m <= 2) return candidate
        candidate = new Date(candidate.getTime() + 60 * 1000)
      }
      return candidate
    }
  }
  return candidate
}

export function poissonJitterSeconds(rateLambdaPerMin = 6): number {
  // Inverse-CDF for an exponential with mean 60/lambda seconds.
  // u in (0,1] — guard against u=0 (Math.random() can return it).
  const u = Math.max(Math.random(), 1e-9)
  const meanSec = 60 / Math.max(rateLambdaPerMin, 0.1)
  const sec = -Math.log(u) * meanSec
  // Clip to a sane range so a heavy tail doesn't park a send 4 hours from now.
  return Math.min(Math.max(sec, MIN_INBOX_GAP_SECONDS), 15 * 60)
}
