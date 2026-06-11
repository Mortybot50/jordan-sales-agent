/**
 * Unit coverage for src/lib/suppression.ts — the outbound firewall.
 * A bug here emails a suppressed person: Spam Act strict liability.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// supabase client must never be constructed in unit tests — stub the module.
const fromMock = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { from: (...args: unknown[]) => fromMock(...args) },
}))

import {
  normaliseEmail,
  extractDomain,
  isValidEmail,
  isValidDomain,
  isSuppressed,
  getSuppressionSet,
  type SuppressionSet,
} from '@/lib/suppression'

describe('normaliseEmail', () => {
  it('lowercases and trims', () => {
    expect(normaliseEmail('  Foo@Bar.COM ')).toBe('foo@bar.com')
  })
  it('strips +aliases so one entry covers all variants', () => {
    expect(normaliseEmail('foo+promo@bar.com')).toBe('foo@bar.com')
    expect(normaliseEmail('foo+a+b@bar.com')).toBe('foo@bar.com')
  })
  it('passes through non-emails unchanged (lowercased)', () => {
    expect(normaliseEmail('NOT-AN-EMAIL')).toBe('not-an-email')
  })
})

describe('extractDomain', () => {
  it('returns the domain part', () => {
    expect(extractDomain('a@b.com')).toBe('b.com')
  })
  it('returns lowercased input when no @', () => {
    expect(extractDomain('B.COM')).toBe('b.com')
  })
})

describe('isValidEmail / isValidDomain', () => {
  it('accepts a normal address and rejects junk', () => {
    expect(isValidEmail('jordan@purezza.com.au')).toBe(true)
    expect(isValidEmail('not an email')).toBe(false)
    expect(isValidEmail('a@b')).toBe(false)
  })
  it('domain must have a dot and no @', () => {
    expect(isValidDomain('purezza.com.au')).toBe(true)
    expect(isValidDomain('a@b.com')).toBe(false)
    expect(isValidDomain('localhost')).toBe(false)
  })
})

describe('isSuppressed', () => {
  const set: SuppressionSet = {
    emails: new Set(['foo@bar.com']),
    domains: new Set(['blocked.com.au']),
  }
  it('matches exact email after normalisation (case + alias)', () => {
    expect(isSuppressed('FOO@BAR.COM', set)).toBe(true)
    expect(isSuppressed('foo+xyz@bar.com', set)).toBe(true)
  })
  it('matches by suppressed domain', () => {
    expect(isSuppressed('anyone@blocked.com.au', set)).toBe(true)
  })
  it('does not suppress unknown addresses or empty input', () => {
    expect(isSuppressed('ok@fine.com', set)).toBe(false)
    expect(isSuppressed(null, set)).toBe(false)
    expect(isSuppressed('', set)).toBe(false)
    expect(isSuppressed('no-at-sign', set)).toBe(false)
  })
})

describe('getSuppressionSet — PostgREST 1000-row pagination', () => {
  beforeEach(() => fromMock.mockReset())

  function chainReturning(pages: Array<{ data: unknown[] | null; error: { message: string } | null }>) {
    let call = 0
    return () => ({
      select: () => ({
        eq: () => ({
          order: () => ({
            range: () => Promise.resolve(pages[Math.min(call++, pages.length - 1)]),
          }),
        }),
      }),
    })
  }

  it('merges multiple pages so entries past row 1000 still suppress', async () => {
    const page1 = Array.from({ length: 1000 }, (_, i) => ({
      email: `p1-${i}@x.com`,
      domain_suppression: false,
    }))
    const page2 = [
      { email: 'tail@end.com', domain_suppression: false },
      { email: 'blockeddomain.com', domain_suppression: true },
    ]
    fromMock.mockImplementation(chainReturning([
      { data: page1, error: null },
      { data: page2, error: null },
    ]))

    const set = await getSuppressionSet('org-1')
    expect(set.emails.size).toBe(1001)
    expect(set.emails.has('tail@end.com')).toBe(true)
    expect(set.domains.has('blockeddomain.com')).toBe(true)
    expect(isSuppressed('tail@end.com', set)).toBe(true)
  })

  it('stops after a partial page (single round-trip for small lists)', async () => {
    fromMock.mockImplementation(chainReturning([
      { data: [{ email: 'a@b.com', domain_suppression: false }], error: null },
    ]))
    const set = await getSuppressionSet('org-1')
    expect(set.emails.has('a@b.com')).toBe(true)
    expect(fromMock).toHaveBeenCalledTimes(1)
  })

  it('fails CLOSED on query error (throws, never returns an empty set)', async () => {
    fromMock.mockImplementation(chainReturning([
      { data: null, error: { message: 'boom' } },
    ]))
    await expect(getSuppressionSet('org-1')).rejects.toThrow(/Failed to load suppression list/)
  })
})
