import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useAuth } from '@/hooks/useAuth'
import {
  useActiveLearningDigest,
  useDecideRule,
  type ProposedRule,
} from '@/lib/queries/learning'

/**
 * LearningBanner — thin, dismissible bar at the top of the Draft Queue.
 * Shown only when the current user has a digest with at least one pending rule.
 *
 * Clicking "Review" opens a modal listing each proposed rule with
 * Approve / Reject / Skip controls. Approve appends the rule text to
 * `users.voice_rules`; Reject marks the rule dismissed without touching voice_rules.
 */
export function LearningBanner({ digestIdFromUrl }: { digestIdFromUrl?: string | null }) {
  const { user } = useAuth()
  const { data: digest } = useActiveLearningDigest(user?.id)
  const decide = useDecideRule()

  const [open, setOpen] = useState(false)

  // Auto-open when the URL points at this digest (email deeplink: /drafts?learning=<id>)
  useEffect(() => {
    if (digestIdFromUrl && digest && digest.id === digestIdFromUrl) {
      setOpen(true)
    }
  }, [digestIdFromUrl, digest])

  if (!digest || !user) return null

  const pendingRules = (digest.proposed_rules ?? []).filter((r) => r.status === 'pending')
  if (pendingRules.length === 0) return null

  return (
    <>
      <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 px-4 py-2.5 text-sm sm:mx-6">
        <div className="flex items-center gap-2 text-ink">
          <Sparkles className="h-4 w-4 text-ink-muted" aria-hidden="true" />
          <span>
            <span className="font-semibold jordan-tnum">{pendingRules.length}</span>{' '}
            rule {pendingRules.length === 1 ? 'proposal' : 'proposals'} from last week
          </span>
        </div>
        <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
          Review
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Proposed voice rules</DialogTitle>
            <DialogDescription>
              Based on {digest.drafts_analysed} edited{' '}
              {digest.drafts_analysed === 1 ? 'draft' : 'drafts'} this past week.
              Approve a rule to add it to your Voice &amp; Style Rules.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 space-y-3">
            {digest.proposed_rules.map((rule) => (
              <RuleItem
                key={rule.id}
                rule={rule}
                isPending={decide.isPending}
                onDecide={(decision) =>
                  decide.mutate({
                    digestId: digest.id,
                    ruleId: rule.id,
                    decision,
                    userId: user.id,
                  })
                }
              />
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function RuleItem({
  rule,
  isPending,
  onDecide,
}: {
  rule: ProposedRule
  isPending: boolean
  onDecide: (decision: 'approved' | 'rejected') => void
}) {
  const decided = rule.status !== 'pending'
  const label =
    rule.status === 'approved'
      ? 'Added to your rules'
      : rule.status === 'rejected'
        ? 'Dismissed'
        : null

  const count = rule.evidence_drafts.length
  const evidence =
    count > 0 ? `Based on ${count} of your recent drafts` : 'Observed across multiple drafts'

  return (
    <div className="rounded-md border border-hairline bg-surface-2 p-3">
      <div className="text-sm text-ink">{rule.text}</div>
      <div className="mt-1 text-xs text-ink-faint">{evidence}</div>
      <div className="mt-3 flex items-center gap-2">
        {decided ? (
          <span className="text-xs font-medium text-ink-muted">{label}</span>
        ) : (
          <>
            <Button
              size="sm"
              onClick={() => onDecide('approved')}
              disabled={isPending}
            >
              Approve &amp; add to rules
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDecide('rejected')}
              disabled={isPending}
            >
              Reject
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
