/**
 * Tests for the Outscraper / Google Places category → venue_type mapper.
 *
 * Run with: `deno test supabase/functions/_shared/venue-type-mapper.test.ts`.
 */

import {
  classifyVenueType,
  classifyVenueTypeFromCategory,
} from './venue-type-mapper.ts'

function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed${msg ? ` (${msg})` : ''}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

// ── Single-category happy paths ────────────────────────────────────
Deno.test('mapper: maps single category strings to the correct venue_type', () => {
  assertEq(classifyVenueTypeFromCategory('Restaurant'), 'restaurant')
  assertEq(classifyVenueTypeFromCategory('Cafe'), 'cafe')
  assertEq(classifyVenueTypeFromCategory('Café'), 'cafe')
  assertEq(classifyVenueTypeFromCategory('Coffee shop'), 'cafe')
  assertEq(classifyVenueTypeFromCategory('Hotel'), 'hotel')
  assertEq(classifyVenueTypeFromCategory('Inn'), 'hotel')
  assertEq(classifyVenueTypeFromCategory('Bar'), 'bar')
  assertEq(classifyVenueTypeFromCategory('Wine bar'), 'bar')
  assertEq(classifyVenueTypeFromCategory('Cocktail bar'), 'bar')
  assertEq(classifyVenueTypeFromCategory('Pub'), 'pub')
  assertEq(classifyVenueTypeFromCategory('Gastropub'), 'pub')
  assertEq(classifyVenueTypeFromCategory('Night club'), 'club')
  assertEq(classifyVenueTypeFromCategory('Nightclub'), 'club')
})

Deno.test('mapper: maps QSR / fast-food categories', () => {
  assertEq(classifyVenueTypeFromCategory('Fast food restaurant'), 'qsr')
  assertEq(classifyVenueTypeFromCategory('Takeaway'), 'qsr')
  assertEq(classifyVenueTypeFromCategory('Take-out'), 'qsr')
})

Deno.test('mapper: maps function-centre / wedding-venue categories', () => {
  assertEq(classifyVenueTypeFromCategory('Wedding venue'), 'function_centre')
  assertEq(classifyVenueTypeFromCategory('Event venue'), 'function_centre')
  assertEq(classifyVenueTypeFromCategory('Function centre'), 'function_centre')
  assertEq(classifyVenueTypeFromCategory('Function center'), 'function_centre')
  assertEq(classifyVenueTypeFromCategory('Banquet hall'), 'function_centre')
})

Deno.test('mapper: maps event-space / meeting-room categories', () => {
  assertEq(classifyVenueTypeFromCategory('Event space'), 'event_space')
  assertEq(classifyVenueTypeFromCategory('Meeting room'), 'event_space')
  assertEq(classifyVenueTypeFromCategory('Conference centre'), 'event_space')
})

Deno.test('mapper: cuisine-prefixed restaurants resolve to "restaurant"', () => {
  assertEq(classifyVenueTypeFromCategory('Italian restaurant'), 'restaurant')
  assertEq(classifyVenueTypeFromCategory('Mexican restaurant'), 'restaurant')
  assertEq(classifyVenueTypeFromCategory('Asian restaurant'), 'restaurant')
  assertEq(classifyVenueTypeFromCategory('Pizza restaurant'), 'restaurant')
})

// ── Ambiguity / priority ───────────────────────────────────────────
Deno.test('mapper: ambiguous "Italian restaurant and pizza bar" picks bar (priority)', () => {
  assertEq(
    classifyVenueTypeFromCategory('Italian restaurant and pizza bar'),
    'bar',
  )
})

Deno.test('mapper: "Restaurant and wine bar" picks bar', () => {
  assertEq(classifyVenueTypeFromCategory('Restaurant and wine bar'), 'bar')
})

// ── Case insensitivity ────────────────────────────────────────────
Deno.test('mapper: case-insensitive', () => {
  assertEq(classifyVenueTypeFromCategory('RESTAURANT'), 'restaurant')
  assertEq(classifyVenueTypeFromCategory('Cafe'), 'cafe')
  assertEq(classifyVenueTypeFromCategory('hotel'), 'hotel')
})

// ── Null / empty / unknown ────────────────────────────────────────
Deno.test('mapper: null / empty / unknown returns null (NOT "other")', () => {
  assertEq(classifyVenueTypeFromCategory(null), null)
  assertEq(classifyVenueTypeFromCategory(undefined), null)
  assertEq(classifyVenueTypeFromCategory(''), null)
  assertEq(classifyVenueTypeFromCategory('   '), null)
  assertEq(classifyVenueTypeFromCategory('Massage parlour'), null)
  assertEq(classifyVenueTypeFromCategory('Dentist'), null)
})

// ── Array input ───────────────────────────────────────────────────
Deno.test('mapper: array input — highest-priority match across joined blob wins', () => {
  assertEq(
    classifyVenueType(['Restaurant', 'Italian restaurant', 'Wine bar']),
    'bar',
  )
  assertEq(
    classifyVenueType(['Hotel', 'Bar', 'Restaurant']),
    'bar',
  )
})

Deno.test('mapper: array input — cafe-only categories classify as cafe', () => {
  assertEq(classifyVenueType(['Cafe', 'Coffee shop']), 'cafe')
})

Deno.test('mapper: hotel + restaurant combo classifies as hotel (priority)', () => {
  // Hotel rule sits above restaurant rule, so a venue tagged both ways
  // (e.g. an "Italian restaurant" inside a hotel) classifies as hotel.
  assertEq(classifyVenueType(['Hotel', 'Italian restaurant']), 'hotel')
})

Deno.test('mapper: array input — empty / all-null returns null', () => {
  assertEq(classifyVenueType([]), null)
  assertEq(classifyVenueType([null, undefined, '']), null)
})

Deno.test('mapper: array input — ignores null/empty entries and matches remaining', () => {
  assertEq(classifyVenueType([null, '', 'Hotel', null]), 'hotel')
})

// ── Token-boundary guard against substring false positives ────────
Deno.test('mapper: token-boundary — "dinner restaurant" classifies as restaurant, not hotel via "inn"', () => {
  assertEq(classifyVenueTypeFromCategory('Dinner restaurant'), 'restaurant')
})

Deno.test('mapper: token-boundary — "barber shop" alone classifies as null, not bar', () => {
  assertEq(classifyVenueTypeFromCategory('Barber shop'), null)
})

Deno.test('mapper: token-boundary — "barber shop and bar" still matches bar (later occurrence)', () => {
  assertEq(classifyVenueTypeFromCategory('Barber shop and bar'), 'bar')
})

Deno.test('mapper: token-boundary — "cafeteria" alone does NOT match cafe', () => {
  assertEq(classifyVenueTypeFromCategory('Cafeteria'), null)
})

Deno.test('mapper: token-boundary — punctuation-adjacent matches still work', () => {
  assertEq(classifyVenueTypeFromCategory('Restaurant, bar'), 'bar')
  assertEq(classifyVenueTypeFromCategory('(Italian restaurant)'), 'restaurant')
})

Deno.test('mapper: Google Places snake_case types (underscore as separator)', () => {
  // Google Places `types` array uses snake_case like `night_club`,
  // `meal_takeaway`. The mapper treats `_` as a non-word char so the
  // boundary check still passes. The SQL backfill migration normalises
  // underscores to spaces to keep parity — see migration comment.
  assertEq(classifyVenueTypeFromCategory('night_club'), 'club')
  assertEq(classifyVenueTypeFromCategory('meal_takeaway'), 'qsr')
  assertEq(classifyVenueTypeFromCategory('fast_food_restaurant'), 'qsr')
})
