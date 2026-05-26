/**
 * Minimal 5-field cron parser — validation, "does this fire at minute M?",
 * and "next fire time after T".
 *
 * Supports the subset pg_cron itself supports:
 *   - 5 fields (no seconds, no year)
 *   - `*` wildcard
 *   - lists: `1,3,5`
 *   - ranges: `1-5`
 *   - step values: `* / 5` (any minute divisible by 5), `0-30/2`
 *
 * Day-of-week: 0-6 (Sun..Sat). Day-of-month + day-of-week behaviour follows
 * cron's OR semantics: if either field is non-`*`, a fire happens when EITHER
 * matches. (Same as pg_cron / Vixie cron.)
 *
 * Timezone: pg_cron interprets the schedule in **UTC**. All Date inputs MUST
 * be passed as UTC-anchored (`Date` is fine — we read getUTC* members). The
 * UI converts AEST presets to UTC before storing.
 *
 * No external deps — runs in Deno (Edge Function) AND the browser.
 */

const FIELD_RANGES: ReadonlyArray<[number, number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day-of-month
  [1, 12], // month
  [0, 6],  // day-of-week (Sun=0)
]

export type CronFieldSet = ReadonlyArray<number>

export interface ParsedCron {
  minute: CronFieldSet
  hour: CronFieldSet
  dom: CronFieldSet
  month: CronFieldSet
  dow: CronFieldSet
  /** Whether the original day-of-month field was `*` (affects OR semantics). */
  domStar: boolean
  /** Whether the original day-of-week field was `*`. */
  dowStar: boolean
}

export class CronParseError extends Error {}

function parseField(raw: string, min: number, max: number): number[] {
  const out = new Set<number>()
  for (const part of raw.split(',')) {
    const piece = part.trim()
    if (!piece) throw new CronParseError(`empty field segment in "${raw}"`)

    let stepStr: string | undefined
    let rangeStr = piece
    const slashIdx = piece.indexOf('/')
    if (slashIdx >= 0) {
      rangeStr = piece.slice(0, slashIdx)
      stepStr = piece.slice(slashIdx + 1)
    }
    const step = stepStr === undefined ? 1 : Number(stepStr)
    if (!Number.isInteger(step) || step < 1) {
      throw new CronParseError(`bad step in "${piece}"`)
    }

    let lo: number
    let hi: number
    if (rangeStr === '*' || rangeStr === '') {
      lo = min
      hi = max
    } else if (rangeStr.includes('-')) {
      const [a, b] = rangeStr.split('-')
      lo = Number(a)
      hi = Number(b)
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
        throw new CronParseError(`bad range in "${piece}"`)
      }
    } else {
      lo = Number(rangeStr)
      hi = lo
      if (!Number.isInteger(lo)) {
        throw new CronParseError(`bad value "${piece}"`)
      }
    }

    if (lo < min || hi > max || lo > hi) {
      throw new CronParseError(
        `value out of range in "${piece}" (allowed ${min}-${max})`,
      )
    }
    for (let n = lo; n <= hi; n += step) out.add(n)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Parse a 5-field cron expression. Throws CronParseError on invalid input.
 */
export function parseCron(expr: string): ParsedCron {
  const cleaned = expr.trim().replace(/\s+/g, ' ')
  if (!cleaned) throw new CronParseError('empty expression')
  const fields = cleaned.split(' ')
  if (fields.length !== 5) {
    throw new CronParseError(
      `expected 5 fields, got ${fields.length} ("${cleaned}")`,
    )
  }
  const [m, h, dom, mon, dow] = fields
  return {
    minute: parseField(m, FIELD_RANGES[0][0], FIELD_RANGES[0][1]),
    hour: parseField(h, FIELD_RANGES[1][0], FIELD_RANGES[1][1]),
    dom: parseField(dom, FIELD_RANGES[2][0], FIELD_RANGES[2][1]),
    month: parseField(mon, FIELD_RANGES[3][0], FIELD_RANGES[3][1]),
    dow: parseField(dow, FIELD_RANGES[4][0], FIELD_RANGES[4][1]),
    domStar: dom === '*',
    dowStar: dow === '*',
  }
}

/**
 * Return true if `expr` is a syntactically valid 5-field cron.
 */
export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr)
    return true
  } catch {
    return false
  }
}

/**
 * Does the parsed cron match the given UTC instant (rounded to minute)?
 */
export function matchesAt(parsed: ParsedCron, when: Date): boolean {
  const minute = when.getUTCMinutes()
  const hour = when.getUTCHours()
  const dom = when.getUTCDate()
  const month = when.getUTCMonth() + 1
  const dow = when.getUTCDay()

  if (!parsed.minute.includes(minute)) return false
  if (!parsed.hour.includes(hour)) return false
  if (!parsed.month.includes(month)) return false

  // OR semantics on day-of-month + day-of-week (Vixie cron / pg_cron rule).
  if (parsed.domStar && parsed.dowStar) return true
  if (parsed.domStar) return parsed.dow.includes(dow)
  if (parsed.dowStar) return parsed.dom.includes(dom)
  return parsed.dom.includes(dom) || parsed.dow.includes(dow)
}

/**
 * Does the cron fire at ANY minute boundary inside the half-open window
 * [windowStart, windowEnd)?
 *
 * Used by the dispatcher to detect "this schedule should have fired
 * sometime in the current window". We iterate exact minute boundaries:
 * the first iteration is the smallest minute boundary >= windowStart
 * (via ceil), and we stop strictly before windowEnd. This guarantees
 * every minute boundary belongs to exactly one window, so consecutive
 * dispatcher ticks cannot double-fire the same scheduled time even
 * when pg_cron itself is a few seconds late.
 */
export function firesInWindow(
  parsed: ParsedCron,
  windowStart: Date,
  windowEnd: Date,
): boolean {
  // Ceil to the next minute boundary at or after windowStart.
  const startMs = Math.ceil(windowStart.getTime() / 60_000) * 60_000
  const endMs = windowEnd.getTime()
  for (let t = startMs; t < endMs; t += 60_000) {
    if (matchesAt(parsed, new Date(t))) return true
  }
  return false
}

/**
 * Next firing time strictly after `from` (UTC). Returns null if none found
 * within `lookaheadDays`. O(days * 24 * 60) worst case — fine for 60-day
 * lookahead in client code (~86k iterations, <5ms).
 */
export function nextRunAt(
  parsed: ParsedCron,
  from: Date,
  lookaheadDays = 60,
): Date | null {
  const start = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000
  const limit = start + lookaheadDays * 86_400_000
  for (let t = start; t < limit; t += 60_000) {
    if (matchesAt(parsed, new Date(t))) return new Date(t)
  }
  return null
}
