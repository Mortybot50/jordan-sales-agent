import { useState } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CapsLabel } from '@/components/primitives'
import { ChevronDown } from 'lucide-react'
import {
  type ScoreBreakdownRule,
  RULE_LABELS,
  renderRuleDetail,
  tierColourClasses,
  tierFor,
  tierLabel,
} from '@/lib/leadScoring'

interface WinProbabilityBarProps {
  score: number | null | undefined
  breakdown: ScoreBreakdownRule[] | null | undefined
}

/**
 * Horizontal progress bar showing the deal's explainable win probability.
 * Tap-to-expand reveals the rule breakdown — every rule that ran, whether
 * it fired or not, with its weight and a one-line detail. The "applied"
 * flag drives whether the row shows in normal or muted style; both kinds
 * of rows render so the user can see what was *checked* (not just what
 * tipped the score).
 *
 * Renders a "Score pending" placeholder when score is null. Distinct from
 * the legacy hot/warm/cold lead_score chip rendered on DealCard.
 */
export function WinProbabilityBar({ score, breakdown }: WinProbabilityBarProps) {
  const [open, setOpen] = useState(false)
  const tier = tierFor(score ?? null)
  const colours = tierColourClasses(tier)
  const safeScore = score == null ? 0 : Math.max(0, Math.min(100, score))
  const widthPct = `${safeScore}%`

  if (score == null) {
    return (
      <div className="mb-4 rounded-[10px] border border-hairline bg-surface-2 p-3 space-y-2">
        <CapsLabel>Win probability</CapsLabel>
        <p className="text-[12px] text-ink-faint">
          Score pending — run the backfill or open a deal with conversation
          history to compute.
        </p>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-[10px] border border-hairline bg-surface-2 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <CapsLabel>Win probability</CapsLabel>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-0.5 text-[11px] text-ink-faint hover:text-ink underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-ink/30 rounded"
              aria-label="Show win probability breakdown"
            >
              breakdown
              <ChevronDown
                className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <CapsLabel>Breakdown</CapsLabel>
              <span className="text-[11px] text-ink-faint">
                rules that fired = applied
              </span>
            </div>
            <ul className="space-y-1.5">
              {(breakdown ?? []).map((entry, i) => {
                const label = RULE_LABELS[entry.rule] ?? entry.rule
                const detail = renderRuleDetail(entry)
                const sign = entry.weight >= 0 ? '+' : ''
                return (
                  <li
                    key={`${entry.rule}-${i}`}
                    className={`flex items-start justify-between gap-2 text-[12px] ${
                      entry.applied ? 'text-ink' : 'text-ink-faint line-through decoration-ink-faint/40'
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{label}</p>
                      {detail && (
                        <p className="text-[11px] text-ink-faint truncate">
                          {detail}
                        </p>
                      )}
                    </div>
                    <span
                      className={`shrink-0 jordan-tnum text-[12px] font-semibold ${
                        !entry.applied
                          ? 'text-ink-faint'
                          : entry.weight >= 0
                            ? 'text-[color:var(--jordan-success-text)]'
                            : 'text-[color:var(--jordan-danger-text)]'
                      }`}
                    >
                      {sign}
                      {entry.weight}
                    </span>
                  </li>
                )
              })}
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-3">
        <div
          className="relative h-2 flex-1 rounded-full bg-ink/10 overflow-hidden"
          role="progressbar"
          aria-label="Win probability"
          aria-valuenow={safeScore}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`absolute inset-y-0 left-0 ${colours.fill} transition-[width]`}
            style={{ width: widthPct }}
          />
        </div>
        <div className="flex items-baseline gap-1.5 shrink-0">
          <span className="jordan-tnum text-[18px] font-semibold text-ink">
            {safeScore}%
          </span>
          <span
            className={`text-[10px] uppercase tracking-[var(--jordan-tracking-label)] font-semibold ${colours.text}`}
          >
            {tierLabel(tier)}
          </span>
        </div>
      </div>
    </div>
  )
}
