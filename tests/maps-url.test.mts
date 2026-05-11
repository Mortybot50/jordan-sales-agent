/**
 * Pure-logic tests for the Google Maps URL builder used by /api/route/maps-url.
 *
 * Run via the npm `test` script (node --test --experimental-strip-types).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGoogleMapsUrl, type MapsStop } from '../api/route/_maps.ts'

test('buildGoogleMapsUrl: empty list → empty url', () => {
  const r = buildGoogleMapsUrl([], false)
  assert.equal(r.url, '')
  assert.equal(r.count, 0)
})

test('buildGoogleMapsUrl: single unvisited stop → destination-only url', () => {
  const stops: MapsStop[] = [{ lat: -37.8, lng: 144.96, visited: false }]
  const r = buildGoogleMapsUrl(stops, false)
  assert.equal(r.count, 1)
  assert.match(r.url, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-37\.8,144\.96$/)
})

test('buildGoogleMapsUrl: multi-stop → origin + destination + waypoints', () => {
  const stops: MapsStop[] = [
    { lat: 1, lng: 2, visited: false },
    { lat: 3, lng: 4, visited: false },
    { lat: 5, lng: 6, visited: false },
    { lat: 7, lng: 8, visited: false },
  ]
  const r = buildGoogleMapsUrl(stops, false)
  assert.equal(r.count, 4)
  assert.match(r.url, /origin=1%2C2/)
  assert.match(r.url, /destination=7%2C8/)
  // waypoints are pipe-separated and url-encoded (| → %7C)
  assert.match(r.url, /waypoints=3%2C4%7C5%2C6/)
  assert.match(r.url, /travelmode=driving/)
})

test('buildGoogleMapsUrl: skips visited stops by default', () => {
  const stops: MapsStop[] = [
    { lat: 1, lng: 2, visited: true },
    { lat: 3, lng: 4, visited: false },
    { lat: 5, lng: 6, visited: false },
  ]
  const r = buildGoogleMapsUrl(stops, false)
  assert.equal(r.count, 2)
  assert.match(r.url, /origin=3%2C4/)
  assert.match(r.url, /destination=5%2C6/)
})

test('buildGoogleMapsUrl: includeVisited keeps visited stops in order', () => {
  const stops: MapsStop[] = [
    { lat: 1, lng: 2, visited: true },
    { lat: 3, lng: 4, visited: false },
    { lat: 5, lng: 6, visited: false },
  ]
  const r = buildGoogleMapsUrl(stops, true)
  assert.equal(r.count, 3)
  assert.match(r.url, /origin=1%2C2/)
  assert.match(r.url, /destination=5%2C6/)
  assert.match(r.url, /waypoints=3%2C4/)
})

test('buildGoogleMapsUrl: all visited and includeVisited=false → empty url', () => {
  const stops: MapsStop[] = [
    { lat: 1, lng: 2, visited: true },
    { lat: 3, lng: 4, visited: true },
  ]
  const r = buildGoogleMapsUrl(stops, false)
  assert.equal(r.url, '')
  assert.equal(r.count, 0)
})

test('buildGoogleMapsUrl: two-stop trip omits waypoints param', () => {
  const stops: MapsStop[] = [
    { lat: 1, lng: 2, visited: false },
    { lat: 3, lng: 4, visited: false },
  ]
  const r = buildGoogleMapsUrl(stops, false)
  assert.equal(r.count, 2)
  assert.doesNotMatch(r.url, /waypoints=/)
  assert.match(r.url, /origin=1%2C2/)
  assert.match(r.url, /destination=3%2C4/)
})
