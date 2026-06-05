import { Link } from 'react-router-dom'
import { Check, Circle, ArrowRight } from 'lucide-react'
import { CapsLabel } from '@/components/primitives'
import { useOutboundReadiness } from '@/lib/queries/outboundReadiness'
import { cn } from '@/lib/utils'

/**
 * SetupChecklist — dashboard banner that surfaces missing outbound-send
 * prerequisites (profile name, signature, sending inbox) until they're all
 * set. Hides once isReady. Companion to the Draft Review pre-flight guard
 * that throws on approve if any of these are still missing.
 */
export function SetupChecklist() {
  const { data, isLoading } = useOutboundReadiness()
  if (isLoading || !data || data.isReady) return null

  const items: { label: string; ok: boolean; to: string }[] = [
    { label: 'Profile name set', ok: data.profileNameSet, to: '/settings' },
    { label: 'Brand signature added', ok: data.hasSignature, to: '/settings' },
    { label: 'Sending inbox connected', ok: data.hasInbox, to: '/settings/email-accounts' },
  ]

  return (
    <div
      data-testid="setup-checklist"
      className="rounded-[10px] border border-hairline bg-[color:var(--jordan-warm-soft)] p-4 sm:p-5"
    >
      <CapsLabel className="text-[9px] text-[color:var(--jordan-warm-text)]">
        Finish setting up
      </CapsLabel>
      <p className="mt-1 text-[13px] text-ink">
        Drafts can't go out until each of these is green.
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-center gap-2">
            {item.ok ? (
              <Check className="size-4 text-[color:var(--jordan-success-text)] shrink-0" />
            ) : (
              <Circle className="size-4 text-ink-faint shrink-0" />
            )}
            <span
              className={cn(
                'text-[13px]',
                item.ok ? 'text-ink-muted line-through' : 'text-ink',
              )}
            >
              {item.label}
            </span>
            {!item.ok && (
              <Link
                to={item.to}
                className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-[color:var(--jordan-accent-hover)] hover:underline"
              >
                Fix this
                <ArrowRight className="size-3" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
