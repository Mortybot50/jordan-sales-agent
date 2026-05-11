/**
 * Pure-logic tests for the day-of-week helpers in api/route/_helpers.ts.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isValidDayOfWeek, jsDayToIsoWeekday } from '../api/route/_helpers.ts'

test('isValidDayOfWeek: accepts 1..6', () => {
  for (let i = 1; i <= 6; i++) assert.equal(isValidDayOfWeek(i), true)
})

test('isValidDayOfWeek: rejects 0 (Sun) and 7+', () => {
  assert.equal(isValidDayOfWeek(0), false)
  assert.equal(isValidDayOfWeek(7), false)
  assert.equal(isValidDayOfWeek(8), false)
  assert.equal(isValidDayOfWeek(-1), false)
})

test('isValidDayOfWeek: rejects non-integers and other types', () => {
  assert.equal(isValidDayOfWeek(1.5), false)
  assert.equal(isValidDayOfWeek('1'), false)
  assert.equal(isValidDayOfWeek(null), false)
  assert.equal(isValidDayOfWeek(undefined), false)
})

test('jsDayToIsoWeekday: Monday', () => {
  // JS day 1 = Mon → ISO 1
  assert.equal(jsDayToIsoWeekday(1), 1)
})

test('jsDayToIsoWeekday: Saturday', () => {
  // JS day 6 = Sat → ISO 6
  assert.equal(jsDayToIsoWeekday(6), 6)
})

test('jsDayToIsoWeekday: Sunday wraps to 7', () => {
  // JS day 0 = Sun → ISO 7
  assert.equal(jsDayToIsoWeekday(0), 7)
})

test('jsDayToIsoWeekday: full week mapping', () => {
  const expected = [7, 1, 2, 3, 4, 5, 6] // Sun..Sat → ISO
  for (let i = 0; i < 7; i++) {
    assert.equal(jsDayToIsoWeekday(i), expected[i])
  }
})
