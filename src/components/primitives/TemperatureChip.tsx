import * as React from 'react'
import { StatusPill } from './StatusPill'
import { cn } from '@/lib/utils'

/**
 * TemperatureChip — the lead-heat chip on deal cards and detail headers.
 * Thin wrapper over StatusPill so hot/warm/cold stay on the Jordan tokens.
 * A manually-overridden temperature shows a small "pinned" dot so Jordan can
 * tell his own call apart from the classifier's.
 */
export type DealTemperature = 'hot' | 'warm' | 'cold'

const LABEL: Record<DealTemperature, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
}

export interface TemperatureChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  temperature: DealTemperature | null | undefined
  /** 'manual' renders the pinned indicator (override never auto-clobbered). */
  source?: 'auto' | 'manual'
}

export function TemperatureChip({ temperature, source = 'auto', className, ...rest }: TemperatureChipProps) {
  if (!temperature) return null
  return (
    <StatusPill
      tone={temperature}
      uppercase
      dot
      className={cn('shrink-0', className)}
      title={
        source === 'manual'
          ? `${LABEL[temperature]} — set by you (won't be auto-changed)`
          : `${LABEL[temperature]} — auto-classified from replies & meetings`
      }
      {...rest}
    >
      {LABEL[temperature]}
      {source === 'manual' && <span aria-hidden>•</span>}
    </StatusPill>
  )
}
