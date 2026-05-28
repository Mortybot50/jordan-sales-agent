/**
 * Per-worker expected fire intervals — drives the "stale" health
 * computation on /admin/workers. Keys must match `worker_runs.worker_name`
 * values inserted by each background worker.
 *
 * Health rules (see AdminWorkersPage):
 *   healthy  — last success within `intervalMs`
 *   stale    — last fire (any status) older than `intervalMs * 2`
 *   failing  — last 3 runs were all `failed`
 *   idle     — never fired
 */
export type WorkerKey =
  | 'morning_briefing'
  | 'reopening_radar_poll'
  | 'learning_digest'
  | 'sequence_tick'
  | 'send_warmup_tick'
  | 'poll_replies'
  | 'enqueue_sends'
  | 'drain_send_queue'
  | 'process_bounces'

export interface WorkerExpectedInterval {
  intervalMs: number
  /** Human-readable cadence shown next to the worker name. */
  label: string
  /** Display title — falls back to worker_name if absent. */
  title?: string
  /** One-line description of what the worker does. */
  description?: string
}

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export const WORKER_EXPECTED_INTERVALS: Record<WorkerKey, WorkerExpectedInterval> = {
  morning_briefing: {
    intervalMs: HOUR,
    label: 'Hourly',
    title: 'Morning briefing',
    description: 'Fires hourly; gates send on each user’s Melbourne local hour.',
  },
  reopening_radar_poll: {
    intervalMs: 7 * DAY,
    label: 'Weekly',
    title: 'Reopening radar',
    description: 'Polls VCGLR/Places signals for venue reopenings.',
  },
  learning_digest: {
    intervalMs: 7 * DAY,
    label: 'Weekly',
    title: 'Learning digest',
    description: 'Sunday 21:00 — Claude proposes voice-rule updates from edits.',
  },
  sequence_tick: {
    intervalMs: HOUR,
    label: 'Hourly',
    title: 'Sequence tick',
    description:
      'Hourly at :15 — generates next-step drafts for active sequence enrolments. Drafts only; Jordan reviews before send.',
  },
  // Cold-send workers — added 28/05/2026 per AUDIT-2026-05-28 P1-OBS-01.
  // send_warmup_tick does NOT write worker_runs (warmup tracks via
  // email_send_events.metadata.kind='warmup'); the AdminWorkersPage shows a
  // dedicated warmup-pulse widget reading that table directly.
  send_warmup_tick: {
    intervalMs: 30 * MIN,
    label: 'Every 30 min',
    title: 'Warmup tick',
    description:
      'Drives inter-inbox warmup sends + replies through the mandatory 14-day ramp. Health surfaced via warmup-pulse widget, not worker_runs.',
  },
  poll_replies: {
    intervalMs: 5 * MIN,
    label: 'Every 5 min',
    title: 'Reply poller',
    description:
      'IMAP poll across active mailboxes — captures real replies, fires intent classification + auto-unsubscribe + warm-reply WhatsApp push.',
  },
  enqueue_sends: {
    intervalMs: 5 * MIN,
    label: 'Every 5 min',
    title: 'Enqueue sends',
    description:
      'Promotes approved drafts into the send queue — applies suppression + verification + per-tz daily cap + pacing + anti-clustering.',
  },
  drain_send_queue: {
    intervalMs: 2 * MIN,
    label: 'Every 2 min',
    title: 'Drain send queue',
    description:
      'Claims due queue rows + dispatches via SMTP. The actual outbound-send path; failures here are the most operator-relevant.',
  },
  process_bounces: {
    intervalMs: 15 * MIN,
    label: 'Every 15 min',
    title: 'Bounce processor',
    description:
      'Scans IMAP for DSN bounces, marks send rows bounced, auto-suppresses hard-bouncing recipients.',
  },
}

export function getWorkerMeta(name: string): WorkerExpectedInterval | null {
  return (WORKER_EXPECTED_INTERVALS as Record<string, WorkerExpectedInterval>)[name] ?? null
}
