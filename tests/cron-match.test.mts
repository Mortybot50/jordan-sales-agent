import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  parseCron,
  isValidCron,
  matchesAt,
  firesInWindow,
  nextRunAt,
  CronParseError,
} from '../src/lib/cron/match.ts'

test('parseCron accepts canonical preset expressions', () => {
  assert.ok(parseCron('0 6 * * *'))            // Daily 6am UTC
  assert.ok(parseCron('0 6 * * 1'))            // Weekly Mon 6am UTC
  assert.ok(parseCron('0 6 * * 1,4'))          // Mon + Thu 6am UTC
  assert.ok(parseCron('0 6 1 * *'))            // Monthly 1st 6am UTC
  assert.ok(parseCron('*/5 * * * *'))          // Every 5 min
  assert.ok(parseCron('0 6 * * 1-5'))          // Weekdays 6am UTC
})

test('parseCron rejects invalid expressions', () => {
  assert.throws(() => parseCron(''), CronParseError)
  assert.throws(() => parseCron('* * * *'), CronParseError)         // 4 fields
  assert.throws(() => parseCron('* * * * * *'), CronParseError)     // 6 fields
  assert.throws(() => parseCron('60 * * * *'), CronParseError)      // minute out of range
  assert.throws(() => parseCron('* 24 * * *'), CronParseError)      // hour out of range
  assert.throws(() => parseCron('* * 32 * *'), CronParseError)      // dom out of range
  assert.throws(() => parseCron('* * * 13 *'), CronParseError)      // month out of range
  assert.throws(() => parseCron('* * * * 7'), CronParseError)       // dow out of range
  assert.throws(() => parseCron('5-2 * * * *'), CronParseError)     // reversed range
  assert.throws(() => parseCron('*/0 * * * *'), CronParseError)     // zero step
  assert.throws(() => parseCron('abc * * * *'), CronParseError)
})

test('isValidCron mirrors parseCron', () => {
  assert.equal(isValidCron('0 20 * * *'), true)
  assert.equal(isValidCron('not a cron'), false)
})

test('matchesAt — "Daily 6am AEST" fires at 20:00 UTC each day', () => {
  const p = parseCron('0 20 * * *')
  // Tue 2026-05-27 20:00 UTC = Wed 06:00 AEST
  assert.equal(matchesAt(p, new Date('2026-05-27T20:00:00Z')), true)
  assert.equal(matchesAt(p, new Date('2026-05-27T20:01:00Z')), false)
  assert.equal(matchesAt(p, new Date('2026-05-27T19:00:00Z')), false)
})

test('matchesAt — "Weekly Mon 6am AEST" fires only on Sun UTC', () => {
  const p = parseCron('0 20 * * 0')
  assert.equal(matchesAt(p, new Date('2026-05-31T20:00:00Z')), true)  // Sunday
  assert.equal(matchesAt(p, new Date('2026-06-01T20:00:00Z')), false) // Monday UTC
})

test('matchesAt — Mon+Thu AEST: Sun + Wed UTC', () => {
  const p = parseCron('0 20 * * 0,3')
  assert.equal(matchesAt(p, new Date('2026-05-31T20:00:00Z')), true)  // Sun
  assert.equal(matchesAt(p, new Date('2026-06-03T20:00:00Z')), true)  // Wed
  assert.equal(matchesAt(p, new Date('2026-06-01T20:00:00Z')), false) // Mon
})

test('matchesAt — dom + dow OR semantics', () => {
  // "1st of month OR Friday" — both fields non-star
  const p = parseCron('0 12 1 * 5')
  assert.equal(matchesAt(p, new Date('2026-06-01T12:00:00Z')), true)  // 1st (Mon)
  assert.equal(matchesAt(p, new Date('2026-06-05T12:00:00Z')), true)  // Fri
  assert.equal(matchesAt(p, new Date('2026-06-03T12:00:00Z')), false) // Wed, not 1st
})

test('firesInWindow — 5-min window catches a once-daily schedule', () => {
  const p = parseCron('0 20 * * *')
  const start = new Date('2026-05-27T19:58:00Z')
  const end   = new Date('2026-05-27T20:03:00Z')
  assert.equal(firesInWindow(p, start, end), true)

  const startMiss = new Date('2026-05-27T20:01:00Z')
  const endMiss   = new Date('2026-05-27T20:06:00Z')
  assert.equal(firesInWindow(p, startMiss, endMiss), false)
})

test('firesInWindow — consecutive minute-aligned windows do not double-fire', () => {
  // Simulates the dispatcher's anchoring: nowMinute = floor(now), with
  // windowEnd = nowMinute + 1 (exclusive). Two consecutive */5 ticks at
  // 06:00:03 and 06:05:03 produce windows [05:56, 06:01) and [06:01, 06:06).
  // A daily "0 6 * * *" schedule must fire exactly once across the two.
  const p = parseCron('0 6 * * *')

  const w1Start = new Date('2026-05-27T05:56:00Z')
  const w1End   = new Date('2026-05-27T06:01:00Z')
  const w2Start = new Date('2026-05-27T06:01:00Z')
  const w2End   = new Date('2026-05-27T06:06:00Z')

  assert.equal(firesInWindow(p, w1Start, w1End), true,  'first window must catch 06:00')
  assert.equal(firesInWindow(p, w2Start, w2End), false, 'second window must NOT re-catch 06:00')
})

test('firesInWindow — late tick (pg_cron 3 sec late) still covers its minute', () => {
  // pg_cron fires at 06:00:03 instead of 06:00:00. After flooring, the
  // dispatcher uses [05:56:00, 06:01:00). The 06:00 minute is included.
  const p = parseCron('0 6 * * *')
  const start = new Date('2026-05-27T05:56:00Z')
  const end   = new Date('2026-05-27T06:01:00Z')
  assert.equal(firesInWindow(p, start, end), true)
})

test('firesInWindow — sub-minute fractional start is still covered cleanly', () => {
  // Old bug: flooring expanded window backwards. Ceil ensures the start
  // minute is honoured strictly. 05:55:30 → ceil to 05:56:00.
  const p = parseCron('55 5 * * *')   // fires at 05:55
  const start = new Date('2026-05-27T05:55:30Z')
  const end   = new Date('2026-05-27T06:00:30Z')
  assert.equal(firesInWindow(p, start, end), false, '05:55 boundary excluded by ceil')
})

test('firesInWindow — */5 fires in any 5-min window', () => {
  const p = parseCron('*/5 * * * *')
  const start = new Date('2026-05-27T20:01:00Z')
  const end   = new Date('2026-05-27T20:06:00Z')
  assert.equal(firesInWindow(p, start, end), true)
})

test('nextRunAt — Daily 6am AEST after Tue 21:00 UTC = Wed 20:00 UTC', () => {
  const p = parseCron('0 20 * * *')
  const next = nextRunAt(p, new Date('2026-05-26T21:00:00Z'))
  assert.equal(next?.toISOString(), '2026-05-27T20:00:00.000Z')
})

test('nextRunAt — within same day if not yet fired', () => {
  const p = parseCron('0 20 * * *')
  const next = nextRunAt(p, new Date('2026-05-27T19:30:00Z'))
  assert.equal(next?.toISOString(), '2026-05-27T20:00:00.000Z')
})

test('nextRunAt — invalid lookahead returns null gracefully', () => {
  // 31st of February — never fires
  const p = parseCron('0 0 31 2 *')
  const next = nextRunAt(p, new Date('2026-05-27T00:00:00Z'), 365)
  assert.equal(next, null)
})
