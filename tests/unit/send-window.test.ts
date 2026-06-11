/**
 * Unit coverage for supabase/functions/_shared/send-window.ts — the
 * send-queue scheduling maths. A bug here sends cold email at 3am or lets
 * the daily cap leak across timezone midnights (audit P1-CP-01).
 */
import { describe, it, expect } from 'vitest'
import {
  MIN_INBOX_GAP_SECONDS,
  currentHourInTz,
  dayStartInTz,
  clampToWorkingWindow,
  poissonJitterSeconds,
} from '../../supabase/functions/_shared/send-window'

const MEL = 'Australia/Melbourne'

describe('currentHourInTz', () => {
  it('converts a UTC instant to Melbourne local hour (AEST, UTC+10 in June)', () => {
    // 2026-06-11 00:30 UTC = 10:30 in Melbourne (winter, no DST)
    expect(currentHourInTz(MEL, new Date('2026-06-11T00:30:00Z'))).toBe(10)
  })
  it('normalises midnight to 0, never 24', () => {
    // 14:00 UTC = 00:00 Melbourne next day
    expect(currentHourInTz(MEL, new Date('2026-06-11T14:00:00Z'))).toBe(0)
  })
  it('falls back to UTC hours on a bad timezone', () => {
    expect(currentHourInTz('Not/AZone', new Date('2026-06-11T07:00:00Z'))).toBe(7)
  })
})

describe('dayStartInTz', () => {
  it('returns Melbourne midnight as the correct UTC instant', () => {
    // Melbourne midnight on 11 Jun 2026 (AEST +10) = 10 Jun 14:00 UTC
    const start = dayStartInTz(new Date('2026-06-11T05:00:00Z'), MEL)
    expect(start.toISOString()).toBe('2026-06-10T14:00:00.000Z')
  })
  it('11pm Melbourne still counts as the SAME Melbourne day (cap-leak regression)', () => {
    // 2026-06-11 13:30 UTC = 23:30 Melbourne on 11 Jun → day start = 10 Jun 14:00 UTC
    const start = dayStartInTz(new Date('2026-06-11T13:30:00Z'), MEL)
    expect(start.toISOString()).toBe('2026-06-10T14:00:00.000Z')
    // ...and 30 minutes later (00:00:01 Melbourne, 12 Jun) rolls to the next day start
    const next = dayStartInTz(new Date('2026-06-11T14:00:01Z'), MEL)
    expect(next.toISOString()).toBe('2026-06-11T14:00:00.000Z')
  })
})

describe('clampToWorkingWindow (08:00–18:00 local)', () => {
  it('returns the input unchanged when already inside the window', () => {
    const inside = new Date('2026-06-11T01:00:00Z') // 11:00 Melbourne
    expect(clampToWorkingWindow(inside, MEL, 8, 18).getTime()).toBe(inside.getTime())
  })
  it('pushes a 3am-local send forward to ~08:00 local', () => {
    const threeAm = new Date('2026-06-10T17:00:00Z') // 03:00 Melbourne 11 Jun
    const clamped = clampToWorkingWindow(threeAm, MEL, 8, 18)
    expect(currentHourInTz(MEL, clamped)).toBe(8)
    expect(clamped.getTime()).toBeGreaterThan(threeAm.getTime())
  })
  it('pushes an after-hours send (19:00 local) into the NEXT morning window', () => {
    const evening = new Date('2026-06-11T09:00:00Z') // 19:00 Melbourne
    const clamped = clampToWorkingWindow(evening, MEL, 8, 18)
    expect(currentHourInTz(MEL, clamped)).toBe(8)
    // Must land on 12 Jun Melbourne, not the same evening
    expect(clamped.getTime() - evening.getTime()).toBeGreaterThan(10 * 60 * 60 * 1000)
  })
  it('snaps near the top of the start hour (minutes 0–2)', () => {
    const evening = new Date('2026-06-11T09:13:00Z')
    const clamped = clampToWorkingWindow(evening, MEL, 8, 18)
    const minute = parseInt(
      new Intl.DateTimeFormat('en-AU', { minute: 'numeric', timeZone: MEL })
        .formatToParts(clamped)
        .find((p) => p.type === 'minute')?.value ?? '99',
      10,
    )
    expect(minute).toBeLessThanOrEqual(2)
  })
})

describe('poissonJitterSeconds', () => {
  it('always respects the minimum inbox gap and the 15-minute ceiling', () => {
    for (let i = 0; i < 5000; i++) {
      const s = poissonJitterSeconds()
      expect(s).toBeGreaterThanOrEqual(MIN_INBOX_GAP_SECONDS)
      expect(s).toBeLessThanOrEqual(15 * 60)
    }
  })
  it('guards against zero/negative lambda', () => {
    const s = poissonJitterSeconds(0)
    expect(Number.isFinite(s)).toBe(true)
    expect(s).toBeLessThanOrEqual(15 * 60)
  })
})
