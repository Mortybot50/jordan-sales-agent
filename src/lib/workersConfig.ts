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

export interface WorkerExpectedInterval {
  intervalMs: number
  /** Human-readable cadence shown next to the worker name. */
  label: string
  /** Display title — falls back to worker_name if absent. */
  title?: string
  /** One-line description of what the worker does. */
  description?: string
}

const HOUR = 60 * 60_000
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
}

export function getWorkerMeta(name: string): WorkerExpectedInterval | null {
  return (WORKER_EXPECTED_INTERVALS as Record<string, WorkerExpectedInterval>)[name] ?? null
}
