/**
 * Unit coverage for src/lib/emailHygiene.ts — CSV-import gatekeeper.
 * A bug here lets junk/role/freemail addresses into the cold-send pipeline.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  classifyEmail,
  evaluateBatch,
  runMxLookups,
  hasMxRecord,
  HYGIENE_FLAG_LABEL,
  type HygieneFlag,
} from '@/lib/emailHygiene'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('classifyEmail (pure, no network)', () => {
  it('flags invalid formats and marks them suspicious', () => {
    for (const bad of ['nope', 'a@b', 'a b@c.com', '@x.com', '']) {
      const v = classifyEmail(bad)
      expect(v.flags).toContain('invalid_format')
      expect(v.suspicious).toBe(true)
    }
  })

  it('flags role addresses (info@, bookings@) even with +tags', () => {
    expect(classifyEmail('info@venue.com.au').flags).toContain('role_address')
    expect(classifyEmail('BOOKINGS+x@venue.com.au').flags).toContain('role_address')
    expect(classifyEmail('reservations@venue.com.au').flags).toContain('role_address')
  })

  it('flags freemail domains including AU ISPs', () => {
    expect(classifyEmail('jo@gmail.com').flags).toContain('freemail')
    expect(classifyEmail('jo@bigpond.com').flags).toContain('freemail')
    expect(classifyEmail('jo@yahoo.com.au').flags).toContain('freemail')
  })

  it('passes a clean decision-maker address with no flags', () => {
    const v = classifyEmail('Marco.Bellini@VenueGroup.com.au')
    expect(v.flags).toEqual([])
    expect(v.suspicious).toBe(false)
    expect(v.normalised).toBe('marco.bellini@venuegroup.com.au')
  })

  it('can stack role + freemail flags', () => {
    const v = classifyEmail('info@gmail.com')
    expect(v.flags).toEqual(expect.arrayContaining(['role_address', 'freemail']))
  })
})

describe('MX lookups (mocked dns.google)', () => {
  function stubDns(answerByDomain: Record<string, number | 'error'>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const domain = decodeURIComponent(new URL(url).searchParams.get('name') ?? '')
      const spec = answerByDomain[domain]
      if (spec === 'error') throw new Error('network down')
      return {
        ok: true,
        json: async () => ({
          Answer: Array.from({ length: spec ?? 0 }, (_, i) => ({ data: `mx${i}` })),
        }),
      }
    }))
  }

  it('hasMxRecord: true with records, false with none, null on error', async () => {
    stubDns({ 'has.com': 2, 'none.com': 0, 'down.com': 'error' })
    expect(await hasMxRecord('has.com')).toBe(true)
    expect(await hasMxRecord('none.com')).toBe(false)
    expect(await hasMxRecord('down.com')).toBe(null)
  })

  it('runMxLookups dedupes domains', async () => {
    stubDns({ 'a.com': 1 })
    const res = await runMxLookups(['a.com', 'a.com', 'a.com'])
    expect(Object.keys(res)).toEqual(['a.com'])
    expect(vi.mocked(fetch).mock.calls.length).toBe(1)
  })

  it('evaluateBatch: no_mx is suspicious, lookup failure is NOT (fail open on network hiccups)', async () => {
    stubDns({ 'solid.com': 1, 'ghost.com': 0, 'flaky.com': 'error' })
    const { verdicts, summary } = await evaluateBatch([
      'ok@solid.com',
      'gone@ghost.com',
      'meh@flaky.com',
      'broken',
    ])
    expect(verdicts[0].suspicious).toBe(false)
    expect(verdicts[1].flags).toContain('no_mx')
    expect(verdicts[1].suspicious).toBe(true)
    expect(verdicts[2].flags).toContain('mx_lookup_failed')
    expect(verdicts[2].suspicious).toBe(false)
    expect(verdicts[3].flags).toContain('invalid_format')
    expect(summary).toMatchObject({ total: 4, invalid: 1, noMx: 1, lookupFailed: 1, domainsChecked: 3 })
  })
})

describe('HYGIENE_FLAG_LABEL', () => {
  it('has a human label for every flag', () => {
    const flags: HygieneFlag[] = ['invalid_format', 'role_address', 'freemail', 'no_mx', 'mx_lookup_failed']
    for (const f of flags) expect(HYGIENE_FLAG_LABEL[f]).toBeTruthy()
  })
})
