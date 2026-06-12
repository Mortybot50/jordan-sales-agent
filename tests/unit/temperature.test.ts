/**
 * Unit coverage for supabase/functions/_shared/temperature.ts — the lead
 * temperature classifier and the PST re-triage mapping. These rules decide
 * which leads Jordan sees as hot, and where 317 imported deals get filed.
 */
import { describe, it, expect } from 'vitest'
import {
  deriveTemperature,
  parsePstNotes,
  isExistingCustomerSubject,
  mapPstStage,
  pstTemperatureSignals,
  businessTitleFromEmail,
  HOT_WINDOW_DAYS,
} from '../../supabase/functions/_shared/temperature'

const NOW = new Date('2026-06-12T00:00:00Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 864e5).toISOString()

describe('deriveTemperature', () => {
  it('hot: positive-intent reply within the 60d window', () => {
    expect(deriveTemperature({
      lastPositiveIntentAt: daysAgo(10), hasAnyInbound: true, hasAnyOutbound: true,
    }, NOW)).toBe('hot')
  })
  it('hot: meeting/site-visit within 60d even without replies', () => {
    expect(deriveTemperature({
      lastMeetingAt: daysAgo(59), hasAnyInbound: false, hasAnyOutbound: true,
    }, NOW)).toBe('hot')
  })
  it('hot: >=2 unanswered inbound (they keep reaching out)', () => {
    expect(deriveTemperature({
      unansweredInboundCount: 2, hasAnyInbound: true, hasAnyOutbound: false,
    }, NOW)).toBe('hot')
  })
  it('warm: positive intent OLDER than 60d decays to warm', () => {
    expect(deriveTemperature({
      lastPositiveIntentAt: daysAgo(HOT_WINDOW_DAYS + 1), hasAnyInbound: true, hasAnyOutbound: true,
    }, NOW)).toBe('warm')
  })
  it('warm: any inbound ever, no recency requirement', () => {
    expect(deriveTemperature({
      lastInboundAt: daysAgo(300), hasAnyInbound: true, hasAnyOutbound: true,
    }, NOW)).toBe('warm')
  })
  it('cold: outbound only', () => {
    expect(deriveTemperature({ hasAnyInbound: false, hasAnyOutbound: true }, NOW)).toBe('cold')
  })
  it('cold: never contacted', () => {
    expect(deriveTemperature({ hasAnyInbound: false, hasAnyOutbound: false }, NOW)).toBe('cold')
  })
  it('ignores garbage timestamps instead of crashing', () => {
    expect(deriveTemperature({
      lastPositiveIntentAt: 'not-a-date', hasAnyInbound: false, hasAnyOutbound: false,
    }, NOW)).toBe('cold')
  })
})

describe('parsePstNotes — real import shapes', () => {
  const WARM = `[purezza-pst-promote] warm lead from 02/06 mailbox import
Trigger: replied 76d ago, you sent 1 msg
Last contact: 2026-03-18 (76d ago)
Inbox/Sent: 1/1
Action: check thread`
  const URGENT = `[purezza-pst-promote] warm lead from 02/06 mailbox import
Trigger: 2 inbox msgs, ZERO sent back
Last contact: 2026-03-30 (64d ago)
Inbox/Sent: 2/0
Action: URGENT — they reached out multiple times`
  const COLD = `[purezza-pst-promote] cold lead from 02/06 mailbox import
Trigger:
Last contact:  (d ago)
Inbox/Sent: 1/1
Action: `

  it('parses the standard warm shape', () => {
    expect(parsePstNotes(WARM)).toEqual({
      isPst: true, warmVerdict: true, inbox: 1, sent: 1,
      lastContact: '2026-03-18', zeroSentBack: false,
    })
  })
  it('parses the urgent zero-sent-back shape', () => {
    const d = parsePstNotes(URGENT)
    expect(d).toMatchObject({ warmVerdict: true, inbox: 2, sent: 0, zeroSentBack: true })
  })
  it('cold shape: warmVerdict false even though inbox counts thread noise', () => {
    const d = parsePstNotes(COLD)
    expect(d).toMatchObject({ isPst: true, warmVerdict: false, inbox: 1, sent: 1, lastContact: null })
  })
  it('non-PST notes are flagged as such', () => {
    expect(parsePstNotes('Met at the expo, call back Tuesday').isPst).toBe(false)
    expect(parsePstNotes(null).isPst).toBe(false)
  })
})

describe('PST stage mapping + temperature (tuned 12/06 against the live import)', () => {
  it('WARM verdict, old reply -> Replied + warm', () => {
    const d = parsePstNotes('[purezza-pst-promote] warm lead\nLast contact: 2026-03-18 (86d ago)\nInbox/Sent: 1/1')
    expect(mapPstStage(d, false)).toBe('Replied')
    expect(deriveTemperature(pstTemperatureSignals(d), NOW)).toBe('warm')
  })
  it('WARM verdict, reply within 30d -> Replied + HOT (unverified-reply window)', () => {
    const d = parsePstNotes('[purezza-pst-promote] warm lead\nLast contact: 2026-05-20 (23d ago)\nInbox/Sent: 1/2')
    expect(mapPstStage(d, false)).toBe('Replied')
    expect(deriveTemperature(pstTemperatureSignals(d), NOW)).toBe('hot')
  })
  it('WARM verdict, reply 42d ago -> warm (outside the 30d unverified window)', () => {
    const d = parsePstNotes('[purezza-pst-promote] warm lead\nLast contact: 2026-05-01 (42d ago)\nInbox/Sent: 1/2')
    expect(deriveTemperature(pstTemperatureSignals(d), NOW)).toBe('warm')
  })
  it('WARM, multiple unanswered inbound -> Replied + HOT even when old', () => {
    const d = parsePstNotes('[purezza-pst-promote] warm lead\nTrigger: 2 inbox msgs, ZERO sent back\nLast contact: 2026-01-05 (158d ago)\nInbox/Sent: 2/0')
    expect(mapPstStage(d, false)).toBe('Replied')
    expect(deriveTemperature(pstTemperatureSignals(d), NOW)).toBe('hot')
  })
  it('COLD verdict -> Contacted + cold even though inbox counts thread noise', () => {
    const d = parsePstNotes('[purezza-pst-promote] cold lead\nInbox/Sent: 1/1')
    expect(d.warmVerdict).toBe(false)
    expect(mapPstStage(d, false)).toBe('Contacted')
    expect(deriveTemperature(pstTemperatureSignals(d), NOW)).toBe('cold')
  })
  it('no traffic at all -> New + cold', () => {
    const d = parsePstNotes('[purezza-pst-promote] cold lead\nInbox/Sent: 0/0')
    expect(mapPstStage(d, false)).toBe('New')
    expect(deriveTemperature(pstTemperatureSignals(d), NOW)).toBe('cold')
  })
  it('existing-customer thread -> Closed regardless of traffic', () => {
    const d = parsePstNotes('[purezza-pst-promote] warm lead\nInbox/Sent: 2/0')
    expect(mapPstStage(d, true)).toBe('Closed')
  })
})

describe('isExistingCustomerSubject', () => {
  it('flags invoice/billing threads', () => {
    expect(isExistingCustomerSubject('Re: Payment Require - Invoice ADV1658737')).toBe(true)
    expect(isExistingCustomerSubject('Statement of account — May')).toBe(true)
  })
  it('does not flag normal outreach threads', () => {
    expect(isExistingCustomerSubject('RE: In your area last week')).toBe(false)
    expect(isExistingCustomerSubject(null)).toBe(false)
  })
})

describe('businessTitleFromEmail', () => {
  it('business domain wins', () => {
    expect(businessTitleFromEmail('eric@steamcafe.com.au')).toBe('steamcafe.com.au')
  })
  it('freemail falls back to the local part', () => {
    expect(businessTitleFromEmail('bennyandmecafe@gmail.com')).toBe('bennyandmecafe')
  })
  it('never returns a raw email; junk returns null', () => {
    expect(businessTitleFromEmail('not-an-email')).toBe(null)
    expect(businessTitleFromEmail(null)).toBe(null)
  })
})
