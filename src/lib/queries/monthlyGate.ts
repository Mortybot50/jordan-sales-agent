import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { startOfMonth, endOfMonth, subMonths, differenceInCalendarDays, format } from 'date-fns'
import { useAuth } from '@/hooks/useAuth'

export interface MonthlyGate {
  id: string
  org_id: string
  user_id: string
  month: string                                     // YYYY-MM-01
  target_acv: number
  achieved_acv: number
  hit_gate: boolean
  locked_at: string | null
  forfeited_at: string | null
  prior_month_commission_amount: number | null
  prior_month_commission_status: 'pending' | 'unlocked' | 'forfeited' | null
  notes: string | null
}

export interface GateView {
  current: MonthlyGate
  prior: MonthlyGate | null
  daysLeftInMonth: number
  pacePerDayRequired: number
}

const DEFAULT_TARGET = 24750

function firstDayISO(d: Date): string {
  return format(d, 'yyyy-MM-01')
}

export function useMonthlyGate() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['monthly-gate', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<GateView> => {
      const now = new Date()
      const monthStart = startOfMonth(now)
      const priorMonthStart = startOfMonth(subMonths(now, 1))
      const monthKey = firstDayISO(monthStart)
      const priorKey = firstDayISO(priorMonthStart)

      const { data, error } = await supabase
        .from('monthly_gates')
        .select('*')
        .in('month', [monthKey, priorKey])
        .order('month', { ascending: false })

      if (error) throw error

      const rows = (data ?? []) as MonthlyGate[]
      const currentRow = rows.find((r) => r.month.startsWith(monthKey))
      const priorRow = rows.find((r) => r.month.startsWith(priorKey)) ?? null

      const fallback: MonthlyGate = {
        id: 'pending',
        org_id: user?.org_id ?? '',
        user_id: user?.id ?? '',
        month: monthKey,
        target_acv: DEFAULT_TARGET,
        achieved_acv: 0,
        hit_gate: false,
        locked_at: null,
        forfeited_at: null,
        prior_month_commission_amount: null,
        prior_month_commission_status: 'pending',
        notes: null,
      }

      const current: MonthlyGate = currentRow
        ? {
            ...currentRow,
            target_acv: Number(currentRow.target_acv),
            achieved_acv: Number(currentRow.achieved_acv),
            prior_month_commission_amount:
              currentRow.prior_month_commission_amount != null
                ? Number(currentRow.prior_month_commission_amount)
                : null,
          }
        : fallback

      const prior: MonthlyGate | null = priorRow
        ? {
            ...priorRow,
            target_acv: Number(priorRow.target_acv),
            achieved_acv: Number(priorRow.achieved_acv),
            prior_month_commission_amount:
              priorRow.prior_month_commission_amount != null
                ? Number(priorRow.prior_month_commission_amount)
                : null,
          }
        : null

      const daysLeftInMonth = Math.max(0, differenceInCalendarDays(endOfMonth(now), now))
      const remaining = Math.max(0, current.target_acv - current.achieved_acv)
      const pacePerDayRequired = daysLeftInMonth > 0 ? remaining / daysLeftInMonth : remaining

      return { current, prior, daysLeftInMonth, pacePerDayRequired }
    },
    staleTime: 30_000,
  })
}

export interface PipelineFinancials {
  pipelineAcvOpen: number
  pipelineTcvOpen: number
  heldForNextMonthAcv: number
  heldForNextMonthCount: number
  earnedThisYearCommission: number
  forecastedCommission: number
  forecastedCommissionCount: number
  pendingInstalls: PendingInstall[]
}

export interface PendingInstall {
  deal_id: string
  title: string | null
  venue_name: string | null
  contact_name: string | null
  product_label: string | null
  signed_at: string
  install_scheduled_for: string | null
  install_confirmed_at: string | null
  acv: number
  commission_amount: number | null
}

export function usePipelineFinancials() {
  return useQuery({
    queryKey: ['dashboard', 'pipeline-financials'],
    queryFn: async (): Promise<PipelineFinancials> => {
      const yearStart = format(startOfMonth(new Date(new Date().getFullYear(), 0, 1)), "yyyy-MM-01'T'00:00:00xxx")

      const { data: dealRows, error } = await supabase
        .from('deals')
        .select(`
          id, title, acv, tcv, contract_value, commission_amount, commission_pct,
          close_won_at, closed_at, outcome, final_value,
          install_scheduled_for, install_confirmed_at, install_completed_at,
          stage:pipeline_stages(id, name, is_closed),
          contact:contacts(id, full_name),
          venue:venues(id, name),
          product:products(id, label)
        `)

      if (error) throw error
      const rows = dealRows ?? []

      let pipelineAcvOpen = 0
      let pipelineTcvOpen = 0
      let heldForNextMonthAcv = 0
      let heldForNextMonthCount = 0
      let earnedThisYearCommission = 0
      let forecastedCommission = 0
      let forecastedCommissionCount = 0
      const pendingInstalls: PendingInstall[] = []

      for (const r of rows as Array<{
        id: string
        title: string | null
        acv: number | string | null
        tcv: number | string | null
        contract_value: number | string | null
        commission_amount: number | string | null
        commission_pct: number | string | null
        close_won_at: string | null
        closed_at: string | null
        outcome: 'won' | 'lost' | null
        final_value: number | string | null
        install_scheduled_for: string | null
        install_confirmed_at: string | null
        install_completed_at: string | null
        stage: { id: string; name: string; is_closed: boolean | null } | null
        contact: { id: string; full_name: string | null } | null
        venue: { id: string; name: string | null } | null
        product: { id: string; label: string | null } | null
      }>) {
        // ACV/TCV are computed by trigger from weekly_price * 52 * term/12 * pct
        // for catalogue-priced deals (since 26/04/2026). Legacy / manually-entered
        // deals only carry contract_value — those would aggregate to $0 on the
        // ACV/TCV tiles, which is what produced the "Pipeline value $X / ACV $0"
        // dashboard contradiction. Fall back to contract_value as the best
        // single-figure approximation for those rows.
        const contractValue = r.contract_value != null ? Number(r.contract_value) : 0
        const acvRaw = r.acv != null ? Number(r.acv) : 0
        const tcvRaw = r.tcv != null ? Number(r.tcv) : 0
        const acv = acvRaw > 0 ? acvRaw : contractValue
        const tcv = tcvRaw > 0 ? tcvRaw : contractValue
        const commission = r.commission_amount != null ? Number(r.commission_amount) : 0
        const finalValue = r.final_value != null ? Number(r.final_value) : null
        const commissionPct = r.commission_pct != null ? Number(r.commission_pct) : null
        const stageName = r.stage?.name ?? ''
        const isClosed = !!r.stage?.is_closed
        const isHeld = stageName === 'Hold for Next Month'
        const isLost = r.outcome === 'lost' || /lost/i.test(stageName)

        if (isHeld) {
          heldForNextMonthAcv += acv
          heldForNextMonthCount += 1
          continue
        }

        if (!isClosed && !isLost) {
          pipelineAcvOpen += acv
          pipelineTcvOpen += tcv
        }

        // Pending install: signed (close_won_at present) but not yet completed.
        if (r.close_won_at && !r.install_completed_at && !isLost) {
          pendingInstalls.push({
            deal_id: r.id,
            title: r.title,
            venue_name: r.venue?.name ?? null,
            contact_name: r.contact?.full_name ?? null,
            product_label: r.product?.label ?? null,
            signed_at: r.close_won_at,
            install_scheduled_for: r.install_scheduled_for,
            install_confirmed_at: r.install_confirmed_at,
            acv,
            commission_amount: commission || null,
          })
        }

        // Earned this year: commission is "earned" only when the unit is
        // installed (per Jordan: "Commission only counts when it's installed.").
        // Won deals awaiting install are forecasted, not earned. Prefer
        // final_value × commission_pct (captured at close); fall back to the
        // auto-computed commission_amount if pct missing.
        if (r.outcome === 'won') {
          const wonCommission =
            finalValue != null && commissionPct != null
              ? (finalValue * commissionPct) / 100
              : commission

          if (r.install_completed_at) {
            if (r.install_completed_at >= yearStart) {
              earnedThisYearCommission += wonCommission
            }
          } else {
            forecastedCommission += wonCommission
            forecastedCommissionCount += 1
          }
        }
      }

      pendingInstalls.sort((a, b) => (a.signed_at > b.signed_at ? 1 : -1))

      return {
        pipelineAcvOpen,
        pipelineTcvOpen,
        heldForNextMonthAcv,
        heldForNextMonthCount,
        earnedThisYearCommission,
        forecastedCommission,
        forecastedCommissionCount,
        pendingInstalls,
      }
    },
    staleTime: 30_000,
  })
}
