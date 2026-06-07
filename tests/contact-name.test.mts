import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deriveContactName } from '../supabase/functions/_shared/contact-name.ts'

test('uses a real name verbatim when provided, never overriding', () => {
  assert.equal(
    deriveContactName({ realName: 'Sarah Chen', email: 'bookings@kingston.com', venueName: 'The Kingston' }),
    'Sarah Chen',
  )
  // Whitespace-only realName is treated as absent.
  assert.equal(
    deriveContactName({ realName: '   ', email: 'info@x.com', venueName: 'Bar X' }),
    'Info — Bar X',
  )
})

test('builds "<Role> — <Venue>" from an alias inbox', () => {
  assert.equal(
    deriveContactName({ email: 'bookings@kingston.com', venueName: 'The Kingston' }),
    'Bookings — The Kingston',
  )
  assert.equal(
    deriveContactName({ email: 'info.team@venue.com', venueName: 'The Local' }),
    'Info Team — The Local',
  )
})

test('all-null / empty inputs fall back to "Unknown contact"', () => {
  assert.equal(deriveContactName({ realName: null, email: null, venueName: null }), 'Unknown contact')
  assert.equal(deriveContactName({ email: undefined }), 'Unknown contact')
  assert.equal(deriveContactName({ email: '' }), 'Unknown contact')
})

test('falls back to venue name, then bare email, when local part is empty', () => {
  // No local part but a venue → venue.
  assert.equal(deriveContactName({ email: null, venueName: 'The Local' }), 'The Local')
  // Email with no venue → the titled local part, else the email itself.
  assert.equal(deriveContactName({ email: 'hello@spot.com' }), 'Hello')
})

test('handles non-ASCII / unicode local parts without throwing', () => {
  const out = deriveContactName({ email: 'joão.silva@bar.com', venueName: 'Bar Lisboa' })
  assert.match(out, /Bar Lisboa$/)
  assert.ok(out.length > 0)
})

test('does not execute or strip HTML-looking input — returns it as inert text', () => {
  // The function never renders HTML; it should pass the string through as data.
  // React escapes it at render time. We assert it stays a plain string and the
  // function does not throw on adversarial input.
  const evil = '<img src=x onerror=alert(1)>'
  const out = deriveContactName({ realName: evil, email: 'a@b.com' })
  assert.equal(out, evil)
  assert.equal(typeof out, 'string')
})
