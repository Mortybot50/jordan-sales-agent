import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Info } from 'lucide-react'
import { DarkMetricCard, DotSeries, SkeletonBlock } from '@/components/primitives'
import type { JordanAnchorMetrics } from '@/lib/queries/dashboard'
import {
  JORDAN_MEETINGS_WEEKLY_TARGET_MIN,
  JORDAN_MEETINGS_WEEKLY_TARGET_MAX,
} from '@/lib/metrics/jordanScore'

interface DarkAnchorBarProps {
  data?: JordanAnchorMetrics
  loading: boolean
}

/**
 * Shared visual + a11y treatment for clickable anchor cards.
 * Hover/focus reveal a small ↗ overlay + subtle mint border lift.
 */
const KPI_LINK_CLS =
  'group relative block rounded-[10px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--jordan-accent-mint)]/60 [&>[data-slot=dark-metric-card]]:transition-colors [&:hover>[data-slot=dark-metric-card]]:border-[color:var(--jordan-accent-mint)]/50 [&:focus-visible>[data-slot=dark-metric-card]]:border-[color:var(--jordan-accent-mint)]/60'

function CardArrow() {
  return (
    <ArrowUpRight
      aria-hidden
      className="pointer-events-none absolute bottom-4 right-5 size-3.5 text-[color:var(--jordan-dark-faint)] opacity-50 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
    />
  )
}

function compactCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return `$${n.toLocaleString()}`
}

/**
 * DarkAnchorBar — Phase F Dashboard hero row.
 *
 * Four DarkMetricCards: Pipeline Value, Qualified Meetings, Response
 * Rate, Jordan Score. Never more than four — the design only works
 * while the dark cards feel scarce.
 */
export function DarkAnchorBar({ data, loading }: DarkAnchorBarProps) {
  if (loading || !data) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} height={186} className="rounded-[10px]" />
        ))}
      </div>
    )
  }

  const {
    pipelineValue,
    pipelineDeltaPct,
    pipelineStageMeter,
    qualifiedMeetingsCount,
    qualifiedMeetingsDelta,
    qualifiedMeetingsTone,
    qualifiedMeter,
    responseRatePct,
    responseRateDelta,
    responseRateMeter,
    jordanScore,
    scoreStreak,
  } = data

  // Hospitality meetings tooltip: 3–5% cold-to-meeting conversion on ~100
  // touches/week = ~4 meetings; warm + referral pipeline lifts the ceiling
  // into the 8–12/week target band.
  const meetingsTooltip =
    'Hospitality benchmark: 3–5% cold-to-meeting conversion. ' +
    '100 touches/week × 4% = 4 meetings. ' +
    `Target ${JORDAN_MEETINGS_WEEKLY_TARGET_MIN}–${JORDAN_MEETINGS_WEEKLY_TARGET_MAX}/week across all channels (cold + referral + warm).`

  const replyTooltip =
    'Hospitality cold benchmark: 8–14%. Below 5% means deliverability, offer, or targeting is broken.'

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <Link
        to="/pipeline"
        className={KPI_LINK_CLS}
        aria-label="Open pipeline · view all deals"
        title="Open pipeline · view all deals"
      >
        <DarkMetricCard
          eyebrow="PIPELINE"
          title="Open pipeline value"
          value={compactCurrency(pipelineValue)}
          delta={pipelineDeltaPct}
          deltaSuffix="%"
          meter={{
            ...pipelineStageMeter,
            label: `${pipelineStageMeter.filled}/${pipelineStageMeter.segments} stages active`,
          }}
        />
        <CardArrow />
      </Link>

      {/*
        title prop on DarkMetricCard is the visible subtitle. The native
        HTML tooltip is the `titleAttr` below, which hover-renders the
        hospitality benchmark copy in lieu of a proper tooltip primitive.
      */}
      <Link
        to="/pipeline?filter=meetings&period=this_week"
        className={KPI_LINK_CLS}
        aria-label="Qualified meetings this week"
        title={meetingsTooltip}
      >
        <DarkMetricCard
          eyebrow="MEETINGS"
          title="Qualified · this week"
          titleAttr={meetingsTooltip}
          value={qualifiedMeetingsCount}
          delta={qualifiedMeetingsDelta}
          meter={{
            ...qualifiedMeter,
            tone: qualifiedMeetingsTone,
            label: `Target band: ${JORDAN_MEETINGS_WEEKLY_TARGET_MIN}–${JORDAN_MEETINGS_WEEKLY_TARGET_MAX}/week`,
          }}
        />
        <CardArrow />
      </Link>

      <Link
        to="/drafts?tab=replies"
        className={KPI_LINK_CLS}
        aria-label="Reply rate · open drafts"
        title={replyTooltip}
      >
        <DarkMetricCard
          eyebrow="RESPONSE"
          title="Reply rate · this week"
          titleAttr={replyTooltip}
          value={responseRatePct === null ? '—' : responseRatePct}
          valueSuffix={responseRatePct === null ? undefined : '%'}
          delta={responseRateDelta}
          deltaSuffix="%"
          meter={{
            ...responseRateMeter,
            label: 'Hospitality cold: 8–14%',
          }}
        />
        <CardArrow />
      </Link>

      <JordanScoreCard
        jordanScore={jordanScore}
        scoreStreak={scoreStreak}
      />
    </div>
  )
}

/**
 * Jordan Score card — clickable to reveal the score-component
 * breakdown popover (no navigation). The whole card is a button.
 */
function JordanScoreCard({
  jordanScore,
  scoreStreak,
}: {
  jordanScore: JordanAnchorMetrics['jordanScore']
  scoreStreak: boolean[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Show Jordan Score components"
        aria-expanded={open}
        title="Click for score breakdown"
        onClick={() => setOpen((v) => !v)}
        className={`${KPI_LINK_CLS} w-full text-left cursor-pointer`}
      >
        <DarkMetricCard
          eyebrow="JORDAN SCORE"
          title={`${jordanScore.tierLabel} · composite`}
          value={jordanScore.score}
          valueSuffix="/ 100"
          delta={jordanScore.trend ?? 0}
          meter={{
            segments: 10,
            filled: jordanScore.tier,
            label: `Tier ${jordanScore.tier} · ${jordanScore.tierLabel}`,
          }}
          footer={
            <div className="flex items-center justify-between gap-3">
              <span className="uppercase tracking-[0.08em] text-[10px] text-[color:var(--jordan-dark-faint)]">
                Last 7 days
              </span>
              <DotSeries
                total={7}
                filled={scoreStreak.filter(Boolean).length}
                pattern={scoreStreak}
                tone="onDark"
                size="sm"
                ariaLabel="Jordan score streak last 7 days"
              />
            </div>
          }
        />
        <Info
          aria-hidden
          className="pointer-events-none absolute bottom-4 right-5 size-3.5 text-[color:var(--jordan-dark-faint)] opacity-50 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity"
        />
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Jordan Score components"
          className="absolute z-20 left-0 right-0 top-full mt-2 rounded-[8px] border border-hairline bg-surface-1 p-3 shadow-lg text-[12px] text-ink"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
              Score components
            </span>
            <button
              type="button"
              className="text-ink-faint hover:text-ink"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <ul className="space-y-1.5 text-ink-muted leading-snug">
            <li>· Reply rate (this week vs hospitality 8–14% band)</li>
            <li>· Qualified meetings (monthly count vs 8–12/wk target)</li>
            <li>· Pipeline velocity (30d reply rate vs prior 30d)</li>
          </ul>
          <p className="mt-2 text-[11px] text-ink-faint">
            Tier {jordanScore.tier} · {jordanScore.tierLabel}.{' '}
            {jordanScore.trend !== null &&
              `WoW trend ${jordanScore.trend >= 0 ? '+' : ''}${jordanScore.trend}.`}
          </p>
        </div>
      )}
    </div>
  )
}
