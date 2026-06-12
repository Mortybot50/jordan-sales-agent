/**
 * _shared/temperature.ts — lead-temperature classifier + PST re-triage mapping.
 *
 * Pure TS, no Deno globals — unit-tested by vitest (tests/unit/temperature.test.ts)
 * and imported by the classify-reply-intent Edge Function for live updates.
 *
 * Temperature rules (final, tuned against the 02/06 PST import — see
 * COMPLETION-REPORT-2.md):
 *   hot  — positive-intent inbound reply OR meeting/site-visit activity within
 *          60 days, OR >=2 inbound messages we never answered (the PST
 *          "URGENT — they reached out multiple times" cohort).
 *   warm — any inbound reply ever.
 *   cold — outbound only, or never contacted.
 *
 * Manual override (deals.temperature_source = 'manual') is enforced by the
 * CALLERS — never re-derive over a manual value.
 */

export type Temperature = 'hot' | 'warm' | 'cold'

export const HOT_WINDOW_DAYS = 60
/**
 * Replies that were never intent-classified (the PST import) get a tighter
 * hot window: a human reply is a strong signal, but without verified positive
 * intent it decays faster. Tuned 12/06 against the live import — 60d would
 * have ranked 180/317 imported deals hot, draining the meaning out of "hot";
 * 30d yields a reviewable set.
 */
export const UNVERIFIED_HOT_WINDOW_DAYS = 30

export interface TemperatureSignals {
  /** Most recent inbound message of any intent (ISO) */
  lastInboundAt?: string | null
  /** Most recent inbound classified positive-intent (ISO) — 60d hot window */
  lastPositiveIntentAt?: string | null
  /** Most recent human reply that was never intent-classified — 30d hot window */
  lastUnverifiedInboundAt?: string | null
  /** Most recent meeting_booked / meeting_note / site-visit activity (ISO) */
  lastMeetingAt?: string | null
  /** Any inbound reply ever */
  hasAnyInbound: boolean
  /** Any outbound from us ever */
  hasAnyOutbound: boolean
  /** Inbound messages with zero outbound reply from us (PST "they reached out") */
  unansweredInboundCount?: number
}

function withinDays(iso: string | null | undefined, days: number, now: Date): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  return now.getTime() - t <= days * 24 * 60 * 60 * 1000
}

export function deriveTemperature(s: TemperatureSignals, now: Date = new Date()): Temperature {
  if (
    withinDays(s.lastPositiveIntentAt, HOT_WINDOW_DAYS, now) ||
    withinDays(s.lastMeetingAt, HOT_WINDOW_DAYS, now) ||
    withinDays(s.lastUnverifiedInboundAt, UNVERIFIED_HOT_WINDOW_DAYS, now) ||
    (s.unansweredInboundCount ?? 0) >= 2
  ) {
    return 'hot'
  }
  if (s.hasAnyInbound) return 'warm'
  return 'cold'
}

// ---------------------------------------------------------------------------
// PST import re-triage helpers
//
// The 02/06 mailbox import wrote a structured block into deals.notes:
//   [purezza-pst-promote] warm lead from 02/06 mailbox import
//   Trigger: replied 76d ago, you sent 1 msg      (or: 2 inbox msgs, ZERO sent back)
//   Last contact: 2026-03-18 (76d ago)
//   Inbox/Sent: 1/1
//   Action: ...
// ---------------------------------------------------------------------------

export interface PstNotesData {
  isPst: boolean
  /**
   * The importer's own verdict. IMPORTANT: the Inbox/Sent counts include
   * Jordan's own messages and auto-acks (verified 12/06: every COLD row has
   * inbox>=1) — so `warmVerdict`, which the importer set only for human
   * replies, is the genuine-inbound signal, NOT inbox>0.
   */
  warmVerdict: boolean
  inbox: number
  sent: number
  lastContact: string | null // YYYY-MM-DD
  zeroSentBack: boolean
}

export function parsePstNotes(notes: string | null | undefined): PstNotesData {
  const n = notes ?? ''
  const isPst = n.includes('[purezza-pst-promote]')
  const io = /Inbox\/Sent:\s*(\d+)\s*\/\s*(\d+)/.exec(n)
  const lc = /Last contact:\s*(\d{4}-\d{2}-\d{2})/.exec(n)
  return {
    isPst,
    warmVerdict: /warm lead/i.test(n),
    inbox: io ? parseInt(io[1], 10) : 0,
    sent: io ? parseInt(io[2], 10) : 0,
    lastContact: lc ? lc[1] : null,
    zeroSentBack: /ZERO sent back/i.test(n),
  }
}

/** Existing-customer signal: invoice/billing threads aren't leads. */
export function isExistingCustomerSubject(subject: string | null | undefined): boolean {
  if (!subject) return false
  return /invoice|payment requ|receipt|statement|order confirm/i.test(subject)
}

export type PstStage = 'New' | 'Contacted' | 'Replied' | 'Closed'

/**
 * Stage mapping for the one-off PST re-triage:
 *   existing-customer thread       -> Closed (Jordan confirms outcome in UI)
 *   importer WARM verdict (human   -> Replied
 *   reply verified)
 *   thread existed, no human reply -> Contacted
 *   no traffic either way          -> New
 */
export function mapPstStage(d: PstNotesData, existingCustomer: boolean): PstStage {
  if (existingCustomer) return 'Closed'
  if (d.warmVerdict) return 'Replied'
  if (d.sent > 0 || d.inbox > 0) return 'Contacted'
  return 'New'
}

export function pstTemperatureSignals(d: PstNotesData): TemperatureSignals {
  return {
    lastInboundAt: d.warmVerdict ? d.lastContact : null,
    // PST WARM = a human reply the importer verified, but intent was never
    // classified — these route through the tighter 30d unverified window.
    lastPositiveIntentAt: null,
    lastUnverifiedInboundAt: d.warmVerdict ? d.lastContact : null,
    lastMeetingAt: null,
    hasAnyInbound: d.warmVerdict,
    hasAnyOutbound: d.sent > 0,
    unansweredInboundCount: d.warmVerdict && d.zeroSentBack ? d.inbox : 0,
  }
}

const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.com.au', 'hotmail.com',
  'hotmail.com.au', 'outlook.com', 'outlook.com.au', 'live.com', 'live.com.au',
  'bigpond.com', 'bigpond.net.au', 'icloud.com', 'me.com', 'msn.com', 'aol.com',
  'optusnet.com.au', 'iinet.net.au', 'internode.on.net', 'protonmail.com', 'proton.me',
])

/**
 * Business-name title fallback when a deal has no venue (A1): the email domain
 * is the business identity ("steamcafe.com.au"); for freemail addresses the
 * local part is ("bennyandmecafe"). Never returns a raw email address.
 */
export function businessTitleFromEmail(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null
  const [local, domain] = email.trim().toLowerCase().split('@', 2)
  if (!domain) return null
  return FREEMAIL.has(domain) ? local : domain
}
