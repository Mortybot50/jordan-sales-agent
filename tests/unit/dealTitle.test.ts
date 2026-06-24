import { describe, it, expect } from 'vitest'
import { cleanDomain, dealDisplayTitle, stripTitleSuffixes } from '@/lib/dealTitle'

describe('cleanDomain', () => {
  it('strips .com.au TLD and returns Title Case', () => {
    expect(cleanDomain('twoboysbrew.com.au')).toBe('Twoboysbrew')
    expect(cleanDomain('industrykitchens.com.au')).toBe('Industrykitchens')
    expect(cleanDomain('bhbh.com.au')).toBe('Bhbh')
  })

  it('strips hyphen separators and Title Cases each word', () => {
    expect(cleanDomain('two-boys-brew.com')).toBe('Two Boys Brew')
  })

  it('strips underscore separators', () => {
    expect(cleanDomain('some_venue_name.com.au')).toBe('Some Venue Name')
  })

  it('strips www prefix and protocol', () => {
    expect(cleanDomain('www.someplace.net.au')).toBe('Someplace')
    expect(cleanDomain('https://www.someplace.com')).toBe('Someplace')
  })

  it('strips generic TLDs (.com, .net, .io, .co)', () => {
    expect(cleanDomain('venueapp.io')).toBe('Venueapp')
    expect(cleanDomain('mycafe.co')).toBe('Mycafe')
    expect(cleanDomain('example.net')).toBe('Example')
  })

  it('handles multi-part AU second-level domains (.net.au, .org.au)', () => {
    expect(cleanDomain('brewery.net.au')).toBe('Brewery')
    expect(cleanDomain('club.org.au')).toBe('Club')
  })

  it('never returns empty string', () => {
    const result = cleanDomain('x.com')
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('dealDisplayTitle — domain fallback uses cleanDomain', () => {
  it('cleans a domain-only title instead of returning it raw', () => {
    expect(dealDisplayTitle({ title: 'twoboysbrew.com.au' })).toBe('Twoboysbrew')
    expect(dealDisplayTitle({ title: 'industrykitchens.com.au' })).toBe('Industrykitchens')
    expect(dealDisplayTitle({ title: 'bhbh.com.au' })).toBe('Bhbh')
    expect(dealDisplayTitle({ title: 'two-boys-brew.com' })).toBe('Two Boys Brew')
  })

  it('prefers venue.name over domain-only title', () => {
    expect(
      dealDisplayTitle({ title: 'twoboysbrew.com.au', venue: { name: 'Two Boys Brew' } }),
    ).toBe('Two Boys Brew')
  })

  it('falls through to contact name when title is a freemail domain', () => {
    expect(
      dealDisplayTitle({
        title: 'gmail.com',
        contact: { full_name: 'Jane Smith', email: 'jane@gmail.com' },
      }),
    ).toBe('Jane Smith')
  })

  it('cleans business domain from email when title is a full email address', () => {
    expect(
      dealDisplayTitle({
        title: 'john@industrykitchens.com.au',
        contact: { email: 'john@industrykitchens.com.au' },
      }),
    ).toBe('Industrykitchens')
  })

  it('returns stripped title for normal deal titles', () => {
    expect(dealDisplayTitle({ title: 'Chronicles Bar — COLD from PST' })).toBe('Chronicles Bar')
    expect(dealDisplayTitle({ title: 'The Espy' })).toBe('The Espy')
  })
})

describe('stripTitleSuffixes', () => {
  it('strips PST temperature suffixes', () => {
    expect(stripTitleSuffixes('Venue — COLD from PST')).toBe('Venue')
    expect(stripTitleSuffixes('Venue — WARM from PST')).toBe('Venue')
    expect(stripTitleSuffixes('Venue — HOT from PST')).toBe('Venue')
  })

  it('strips Purezza intro suffix', () => {
    expect(stripTitleSuffixes('Marquis of Lorne — Purezza intro')).toBe('Marquis of Lorne')
  })

  it('strips bracket prefixes', () => {
    expect(stripTitleSuffixes('[WALK-26APR] Plain Venue')).toBe('Plain Venue')
  })

  it('is a no-op for clean titles', () => {
    expect(stripTitleSuffixes('The Espy')).toBe('The Espy')
  })
})
