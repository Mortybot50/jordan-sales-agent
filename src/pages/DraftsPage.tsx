import { Mail } from 'lucide-react'

export function DraftsPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
        <Mail className="w-8 h-8 text-muted-foreground" />
      </div>

      <h1 className="text-xl font-semibold mb-2">Draft Review Queue</h1>

      <p className="text-sm text-muted-foreground leading-relaxed mb-4">
        AI layer ships Week 3. Once connected, your email drafts will appear
        here for one-click approval — review, edit, approve, or skip each draft
        before it sends.
      </p>

      <div className="border rounded-xl p-4 text-left w-full space-y-3 bg-muted/30">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          What's coming
        </p>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">·</span>
            <span>Segmented queue: Urgent, Today, New Leads</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">·</span>
            <span>Context card: venue type, last activity, ICP score</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">·</span>
            <span>One-click approve, edit, skip, or reject</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">·</span>
            <span>Keyboard shortcuts: A approve · E edit · S skip · R reject</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">·</span>
            <span>Mobile swipe gestures</span>
          </li>
        </ul>
      </div>
    </div>
  )
}
