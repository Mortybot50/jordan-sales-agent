/**
 * Tests for the canonical hospitality sequence's template helpers.
 *
 * Run with: `deno test supabase/functions/sequence-tick/templates.test.ts`.
 * No Supabase / network access is required — these are pure-function tests
 * with hand-rolled assertions so the file has zero external imports and
 * can be executed in any sandbox where `deno` is available.
 */

import {
  selectVariant,
  renderTemplate,
  firstNameFromFullName,
  looksLikeGenericMailboxAlias,
  type TemplateVariantsConfig,
  type SelectionContext,
} from './templates.ts'

function assertEq<T>(actual: T, expected: T, msg?: string): void {
  if (actual !== expected) {
    throw new Error(
      `Assertion failed${msg ? ` (${msg})` : ''}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
  }
}

function assertIncludes(haystack: string, needle: string, msg?: string): void {
  if (!haystack.includes(needle)) {
    throw new Error(
      `Assertion failed${msg ? ` (${msg})` : ''}: expected output to include ${JSON.stringify(needle)}`,
    )
  }
}

// ── Fixture mirroring the canonical Day-0 step's template_variants JSON ──
const day0Config: TemplateVariantsConfig = {
  selection: 'rule_based',
  variants: [
    {
      id: 'walk_by',
      subject_template: 'Walked past your venue',
      body_template:
        'Hi team,\n\nI was down in {{suburb}} recently and walked past your venue {{venue_name}} — looks like a cracking venue.',
      when: {
        any_of: [
          { kind: 'field_visit_suburb_match', lookback_days: 30 },
          {
            kind: 'venue_type_in',
            values: ['restaurant', 'cafe', 'bar', 'hotel', 'function', 'fine_dining'],
            and_suburb_present: true,
          },
        ],
      },
    },
    {
      id: 'linkedin',
      subject_template: 'A quick idea for your business',
      body_template:
        'Hi {{first_name}},\n\nCame across your profile on LinkedIn.',
      when: null,
    },
  ],
}

// ── Variant selection ──────────────────────────────────────────────
Deno.test('selectVariant: walk-by wins when suburb matches a recent field visit', () => {
  const ctx: SelectionContext = {
    contactSuburb: 'Fitzroy',
    venueType: null,
    recentVisitSuburbs: ['Fitzroy', 'Carlton'],
  }
  assertEq(selectVariant(day0Config, ctx).id, 'walk_by')
})

Deno.test('selectVariant: walk-by wins when venue_type is hospitality and suburb is present', () => {
  const ctx: SelectionContext = {
    contactSuburb: 'Brunswick',
    venueType: 'restaurant',
    recentVisitSuburbs: [],
  }
  assertEq(selectVariant(day0Config, ctx).id, 'walk_by')
})

Deno.test('selectVariant: hospitality venue_type with NO suburb falls back to linkedin', () => {
  const ctx: SelectionContext = {
    contactSuburb: null,
    venueType: 'cafe',
    recentVisitSuburbs: [],
  }
  assertEq(selectVariant(day0Config, ctx).id, 'linkedin')
})

Deno.test('selectVariant: non-hospitality venue with no field visit falls back to linkedin', () => {
  const ctx: SelectionContext = {
    contactSuburb: 'Richmond',
    venueType: 'office',
    recentVisitSuburbs: ['Carlton'],
  }
  assertEq(selectVariant(day0Config, ctx).id, 'linkedin')
})

Deno.test('selectVariant: suburb match is case- and whitespace-insensitive', () => {
  const ctx: SelectionContext = {
    contactSuburb: '  fitzroy  ',
    venueType: null,
    recentVisitSuburbs: ['FITZROY'],
  }
  assertEq(selectVariant(day0Config, ctx).id, 'walk_by')
})

Deno.test('selectVariant: completely unknown contact still resolves to fallback', () => {
  const ctx: SelectionContext = {
    contactSuburb: null,
    venueType: null,
    recentVisitSuburbs: [],
  }
  assertEq(selectVariant(day0Config, ctx).id, 'linkedin')
})

Deno.test('selectVariant: single-variant config always returns that variant', () => {
  const single: TemplateVariantsConfig = {
    selection: 'single',
    variants: [
      {
        id: 'soft_nudge',
        subject_template: 'Following up',
        body_template: 'Hi {{first_name}}, just floating my note.',
        when: null,
      },
    ],
  }
  const ctx: SelectionContext = {
    contactSuburb: 'Anywhere',
    venueType: 'restaurant',
    recentVisitSuburbs: ['Anywhere'],
  }
  assertEq(selectVariant(single, ctx).id, 'soft_nudge')
})

// ── Placeholder rendering ──────────────────────────────────────────
Deno.test('renderTemplate: substitutes all three placeholders', () => {
  const out = renderTemplate(
    'Hi {{first_name}}, walked past {{venue_name}} in {{suburb}}.',
    { first_name: 'Sam', venue_name: 'The Stokehouse', suburb: 'St Kilda' },
  )
  assertEq(out, 'Hi Sam, walked past The Stokehouse in St Kilda.')
})

Deno.test('renderTemplate: handles whitespace inside braces', () => {
  const out = renderTemplate('{{ first_name }} / {{  venue_name  }}', {
    first_name: 'Jo',
    venue_name: 'Tipo00',
    suburb: '',
  })
  assertEq(out, 'Jo / Tipo00')
})

Deno.test('renderTemplate: empty values get sensible neutral fallbacks', () => {
  const out = renderTemplate('Hi {{first_name}} at {{venue_name}} in {{suburb}}.', {
    first_name: '',
    venue_name: '',
    suburb: '',
  })
  assertEq(out, 'Hi there at your venue in the area.')
})

Deno.test('renderTemplate: empty first_name + venue_name present renders "team"', () => {
  const out = renderTemplate('Hi {{first_name}},', {
    first_name: '',
    venue_name: 'Bar Spontana',
    suburb: 'Carlton',
  })
  assertEq(out, 'Hi team,')
})

Deno.test('renderTemplate: empty first_name + no venue_name still renders "there"', () => {
  const out = renderTemplate('Hi {{first_name}},', {
    first_name: '',
    venue_name: '',
    suburb: '',
  })
  assertEq(out, 'Hi there,')
})

Deno.test('renderTemplate: whitespace-only first_name treated as empty', () => {
  const out = renderTemplate('Hi {{first_name}} at {{venue_name}}.', {
    first_name: '   ',
    venue_name: 'Lumen People',
    suburb: '',
  })
  assertEq(out, 'Hi team at Lumen People.')
})

Deno.test('renderTemplate: leaves unknown placeholders untouched', () => {
  const out = renderTemplate('Hi {{first_name}}, your {{unknown_field}}.', {
    first_name: 'Sam',
    venue_name: '',
    suburb: '',
  })
  assertEq(out, 'Hi Sam, your {{unknown_field}}.')
})

Deno.test('renderTemplate: preserves verbatim em-dashes and line breaks', () => {
  const tpl =
    'Hi {{first_name}},\n\nWorth a 10–15 min chat, or should I close the loop?\n\nCheers,\nJordan'
  const out = renderTemplate(tpl, {
    first_name: 'Sam',
    venue_name: '',
    suburb: '',
  })
  assertIncludes(out, '10–15 min chat')
  assertIncludes(out, 'should I close the loop?')
  assertIncludes(out, 'Cheers,\nJordan')
})

// ── firstNameFromFullName ──────────────────────────────────────────
Deno.test('firstNameFromFullName: handles common cases', () => {
  assertEq(firstNameFromFullName("Sam O'Connor"), 'Sam')
  assertEq(firstNameFromFullName('  Jo Tipo  '), 'Jo')
  assertEq(firstNameFromFullName(''), '')
  assertEq(firstNameFromFullName(null), '')
  assertEq(firstNameFromFullName(undefined), '')
})

Deno.test('firstNameFromFullName: returns proper-case first name unchanged', () => {
  assertEq(firstNameFromFullName('Jordan Marziale'), 'Jordan')
})

Deno.test('firstNameFromFullName: returns lowercase non-generic tokens (personal handles)', () => {
  assertEq(firstNameFromFullName('jordan'), 'jordan')
  assertEq(firstNameFromFullName('loc'), 'loc')
  assertEq(firstNameFromFullName('lekker'), 'lekker')
})

Deno.test('firstNameFromFullName: strips Outscraper "<alias> — <venue>" preamble (em-dash)', () => {
  assertEq(firstNameFromFullName('Hello — Lumen People'), '')
  assertEq(firstNameFromFullName('Info — Marquis of Lorne'), '')
  assertEq(firstNameFromFullName('Bookings — Riché - Cafe Richmond'), '')
})

Deno.test('firstNameFromFullName: strips "<alias> – <venue>" preamble (en-dash)', () => {
  assertEq(firstNameFromFullName('Reservations – The Stokehouse'), '')
})

Deno.test('firstNameFromFullName: strips "<alias> - <venue>" preamble (hyphen)', () => {
  assertEq(firstNameFromFullName('Enquiries - Sunrise Brasserie'), '')
})

Deno.test('firstNameFromFullName: returns real first name when alias-prefix has a non-generic local-part', () => {
  // "Sarah — Lumen People" — Sarah is a real personal first name even
  // though it follows the Outscraper auto-stamp shape.
  assertEq(firstNameFromFullName('Sarah — Lumen People'), 'Sarah')
})

Deno.test('firstNameFromFullName: alias-check is case-insensitive', () => {
  assertEq(firstNameFromFullName('HELLO — Whoever'), '')
  assertEq(firstNameFromFullName('Bookings'), '')
  assertEq(firstNameFromFullName('STAFF — Anywhere'), '')
})

Deno.test('firstNameFromFullName: rejects tokens with no letters', () => {
  assertEq(firstNameFromFullName('123'), '')
  assertEq(firstNameFromFullName('---'), '')
  assertEq(firstNameFromFullName('@@@'), '')
})

Deno.test('firstNameFromFullName: does NOT mistake hyphenated names for alias-prefix', () => {
  // "Mary-Jane" has no spaces around the hyphen — should NOT be stripped.
  assertEq(firstNameFromFullName('Mary-Jane Smith'), 'Mary-Jane')
})

// ── looksLikeGenericMailboxAlias direct unit tests ─────────────────
Deno.test('looksLikeGenericMailboxAlias: positive matches', () => {
  for (const t of ['hello', 'info', 'bookings', 'enquiries', 'reservations',
    'events', 'admin', 'team', 'staff', 'kitchen', 'bar', 'manager']) {
    if (!looksLikeGenericMailboxAlias(t)) {
      throw new Error(`expected "${t}" to be generic`)
    }
  }
})

Deno.test('looksLikeGenericMailboxAlias: case-insensitive', () => {
  assertEq(looksLikeGenericMailboxAlias('HELLO'), true)
  assertEq(looksLikeGenericMailboxAlias('Bookings'), true)
  assertEq(looksLikeGenericMailboxAlias('ENQUIRIES'), true)
})

Deno.test('looksLikeGenericMailboxAlias: rejects null / empty / whitespace', () => {
  assertEq(looksLikeGenericMailboxAlias(null), true)
  assertEq(looksLikeGenericMailboxAlias(undefined), true)
  assertEq(looksLikeGenericMailboxAlias(''), true)
  assertEq(looksLikeGenericMailboxAlias('   '), true)
})

Deno.test('looksLikeGenericMailboxAlias: negative matches (real names)', () => {
  for (const t of ['jordan', 'Sam', 'Marco', 'Sarah', 'loc', 'lekker', 'Jo']) {
    if (looksLikeGenericMailboxAlias(t)) {
      throw new Error(`expected "${t}" to be NON-generic`)
    }
  }
})

// ── venue_suburb_present_only rule ─────────────────────────────────
Deno.test('selectVariant: venue_suburb_present_only fires when suburb is set', () => {
  const cfg: TemplateVariantsConfig = {
    selection: 'rule_based',
    variants: [
      {
        id: 'walk_by_safety_net',
        subject_template: 'In your patch',
        body_template: 'Hi {{first_name}}, in {{suburb}}.',
        when: { any_of: [{ kind: 'venue_suburb_present_only' }] },
      },
      {
        id: 'linkedin',
        subject_template: 'A quick idea',
        body_template: 'Hi {{first_name}}, saw your LinkedIn.',
        when: null,
      },
    ],
  }
  const ctx: SelectionContext = {
    contactSuburb: 'Brunswick',
    venueType: null,
    recentVisitSuburbs: [],
  }
  assertEq(selectVariant(cfg, ctx).id, 'walk_by_safety_net')
})

Deno.test('selectVariant: venue_suburb_present_only does NOT fire when suburb is null', () => {
  const cfg: TemplateVariantsConfig = {
    selection: 'rule_based',
    variants: [
      {
        id: 'walk_by_safety_net',
        subject_template: 's',
        body_template: 'b',
        when: { any_of: [{ kind: 'venue_suburb_present_only' }] },
      },
      { id: 'linkedin', subject_template: 's', body_template: 'b', when: null },
    ],
  }
  const ctx: SelectionContext = {
    contactSuburb: null,
    venueType: 'cafe',
    recentVisitSuburbs: [],
  }
  assertEq(selectVariant(cfg, ctx).id, 'linkedin')
})

Deno.test('selectVariant: venue_suburb_present_only does NOT fire when suburb is whitespace-only', () => {
  const cfg: TemplateVariantsConfig = {
    selection: 'rule_based',
    variants: [
      {
        id: 'walk_by_safety_net',
        subject_template: 's',
        body_template: 'b',
        when: { any_of: [{ kind: 'venue_suburb_present_only' }] },
      },
      { id: 'linkedin', subject_template: 's', body_template: 'b', when: null },
    ],
  }
  const ctx: SelectionContext = {
    contactSuburb: '   ',
    venueType: null,
    recentVisitSuburbs: [],
  }
  assertEq(selectVariant(cfg, ctx).id, 'linkedin')
})

Deno.test('selectVariant: any_of with mixed rule kinds — safety net catches null-venue_type case', () => {
  // Mirror of what the canonical Day-0 step's variants[0].when would look
  // like if Jordan opts the safety net in via the in-app editor.
  const cfg: TemplateVariantsConfig = {
    selection: 'rule_based',
    variants: [
      {
        id: 'walk_by',
        subject_template: 'Walked past',
        body_template: 'Hi team in {{suburb}}.',
        when: {
          any_of: [
            { kind: 'field_visit_suburb_match', lookback_days: 30 },
            {
              kind: 'venue_type_in',
              values: ['restaurant', 'cafe', 'bar', 'hotel', 'function', 'fine_dining'],
              and_suburb_present: true,
            },
            { kind: 'venue_suburb_present_only' },
          ],
        },
      },
      { id: 'linkedin', subject_template: 's', body_template: 'b', when: null },
    ],
  }
  // venue_type is null, no recent visit, but suburb is set — safety net should catch it.
  const ctx: SelectionContext = {
    contactSuburb: 'Richmond',
    venueType: null,
    recentVisitSuburbs: [],
  }
  assertEq(selectVariant(cfg, ctx).id, 'walk_by')
})
