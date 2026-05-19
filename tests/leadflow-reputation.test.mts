/**
 * Pure-logic tests for the deterministic inbox-reputation scorer used by the
 * Week 3 analytics dashboard. Mirrors the Postgres function
 * `compute_inbox_reputation` from migration 20260519000008.
 *
 * Run via the npm `test` script (node --test --experimental-strip-types).
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  computeInboxReputation,
  INSUFFICIENT_SIGNAL_SCORE,
  MIN_SENDS_FOR_REPUTATION,
} from '../src/lib/leadflow-reputation.ts'

test('computeInboxReputation: <10 sends returns insufficient-signal floor (50)', () => {
  // No sends at all
  assert.equal(
    computeInboxReputation({ sent: 0, bounced: 0, complained: 0, replied: 0 }),
    INSUFFICIENT_SIGNAL_SCORE,
  )
  // Just under the threshold — should still return the floor even with great signal
  assert.equal(
    computeInboxReputation({
      sent: MIN_SENDS_FOR_REPUTATION - 1,
      bounced: 0,
      complained: 0,
      replied: 5,
    }),
    INSUFFICIENT_SIGNAL_SCORE,
  )
})

test('computeInboxReputation: clean inbox (no bounces/complaints, 10% reply) scores 100 + 10 → clamped 100', () => {
  // 100 sent, 0 bounced, 0 complained, 10 replied = 10% reply rate
  // score = 100 - 0 - 0 + min(10, 25) = 110, clamped to 100
  const score = computeInboxReputation({
    sent: 100,
    bounced: 0,
    complained: 0,
    replied: 10,
  })
  assert.equal(score, 100)
})

test('computeInboxReputation: complaint weight (20x) is heavier than bounce weight (5x)', () => {
  // Scenario A: 1% bounce, no complaint → score = 100 - 5 = 95
  const withBounce = computeInboxReputation({
    sent: 100,
    bounced: 1,
    complained: 0,
    replied: 0,
  })
  // Scenario B: 1% complaint, no bounce → score = 100 - 20 = 80
  const withComplaint = computeInboxReputation({
    sent: 100,
    bounced: 0,
    complained: 1,
    replied: 0,
  })
  assert.equal(withBounce, 95)
  assert.equal(withComplaint, 80)
  // The complaint scenario MUST be punished more harshly than the bounce
  assert.ok(
    withComplaint < withBounce,
    `Complaints should outweigh bounces, got complaint=${withComplaint} bounce=${withBounce}`,
  )
})

test('computeInboxReputation: catastrophic stats clamp to 0 (no negative score)', () => {
  // 100 sent, 50 complained (50% complaint rate), 50 bounced
  // raw = 100 - 50*5 - 50*20 + 0 = 100 - 250 - 1000 = -1150 → clamped to 0
  const score = computeInboxReputation({
    sent: 100,
    bounced: 50,
    complained: 50,
    replied: 0,
  })
  assert.equal(score, 0)
})

test('computeInboxReputation: reply rate boost is capped at +25 (no infinite upside)', () => {
  // 10 sent, 10 replied (100% reply rate) — but still no bounces
  // Replies cap at +25 even though raw rate is 100. score = 100 + 25 = 125 → clamped 100.
  const cappedScore = computeInboxReputation({
    sent: 10,
    bounced: 0,
    complained: 0,
    replied: 10,
  })
  assert.equal(cappedScore, 100)

  // Demonstrate the cap actually clips: with one heavy bounce that would
  // otherwise put us under 100, the reply boost shouldn't restore us beyond
  // +25 of itself. 100 sent, 6 bounced (6%) = -30 bounce, 100% reply = +25 cap
  // score = 100 - 30 + 25 = 95
  const withBounceAndHighReply = computeInboxReputation({
    sent: 100,
    bounced: 6,
    complained: 0,
    replied: 100,
  })
  assert.equal(withBounceAndHighReply, 95)
})
