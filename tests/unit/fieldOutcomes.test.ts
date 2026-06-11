/**
 * Unit coverage for src/lib/fieldOutcomes.ts — shared enum between FieldPage,
 * RoutePage and the DB check constraint on field_visits.outcome.
 */
import { describe, it, expect } from 'vitest'
import { FIELD_OUTCOME_OPTIONS, outcomeLabel, type FieldOutcome } from '@/lib/fieldOutcomes'

describe('FIELD_OUTCOME_OPTIONS', () => {
  it('covers the six DB-constraint values exactly once each', () => {
    const values = FIELD_OUTCOME_OPTIONS.map((o) => o.value)
    expect(values).toEqual(['interested', 'not_now', 'closed', 'not_in', 'dm_absent', 'other'])
    expect(new Set(values).size).toBe(values.length)
  })
  it('every option has a non-empty label', () => {
    for (const o of FIELD_OUTCOME_OPTIONS) expect(o.label.trim()).not.toBe('')
  })
})

describe('outcomeLabel', () => {
  it('maps every known outcome to its label', () => {
    for (const o of FIELD_OUTCOME_OPTIONS) {
      expect(outcomeLabel(o.value as FieldOutcome)).toBe(o.label)
    }
  })
  it('humanises unknown stored values instead of crashing', () => {
    expect(outcomeLabel('left_voicemail')).toBe('left voicemail')
  })
  it('returns empty string for null/undefined/empty', () => {
    expect(outcomeLabel(null)).toBe('')
    expect(outcomeLabel(undefined)).toBe('')
    expect(outcomeLabel('')).toBe('')
  })
})
