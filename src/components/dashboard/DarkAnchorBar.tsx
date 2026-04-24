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

      {/*
        title prop on DarkMetricCard is the visible subtitle. The native
        HTML tooltip is the `titleAttr` below, which hover-renders the
        hospitality benchmark copy in lieu of a proper tooltip primitive.
      */}
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
    </div>
  )
}
