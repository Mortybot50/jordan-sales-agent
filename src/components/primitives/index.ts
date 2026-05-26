/**
 * Jordan primitives — Phase A deliverables.
 *
 * All components here are pure presentation, no data fetching. They
 * bind to Jordan design tokens (see src/styles/tokens.css) and are
 * intended to be composed into Phase B+ screen migrations.
 */

export { StatusPill, type PillTone, type StatusPillProps } from './StatusPill'
export { MetricNumber, type MetricNumberProps, type MetricFormat } from './MetricNumber'
export { KbdHint, type KbdHintProps } from './KbdHint'
export { PageHeader, type PageHeaderProps } from './PageHeader'
export { ScoreBadge, type ScoreBadgeProps } from './ScoreBadge'
export { scoreToTone, scoreToLabel } from './score'
export { DraftTypeBadge, type DraftTypeBadgeProps } from './DraftTypeBadge'
export { ActivityIcon, type ActivityIconProps } from './ActivityIcon'
export { getActivityMeta, type ActivityTone, type ActivityMeta, ACTIVITY_MAP } from './activity-meta'
export { SkeletonRow, SkeletonBlock, SkeletonCard } from './Skeleton'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { ErrorAlert, type ErrorAlertProps } from './ErrorAlert'
export { SortHeader, type SortHeaderProps, type SortDirection } from './SortHeader'
export { DataTable, type DataTableProps, type ColumnDef, type RowDensity } from './DataTable'
export {
  FacetBar,
  type FacetBarProps,
  type FacetDef,
  type FacetOption,
} from './FacetBar'
export { FieldRow, type FieldRowProps, type FieldRowRenderContext } from './FieldRow'
export {
  CommandPalette,
  type CommandPaletteProps,
  type CommandItem,
} from './CommandPalette'

/* ── Feature E — Reply Intent Classifier ───────────────────────── */
export { IntentBadge, type IntentBadgeProps, type ReplyIntent } from './IntentBadge'

/* ── Deal product display (FE-PO-06) ───────────────────────────── */
export { BrandChip, type BrandKey } from './BrandChip'

/* ── Phase F — Dark Anchor ─────────────────────────────────────── */
export { CapsLabel, type CapsLabelProps } from './CapsLabel'
export { MeterRail, type MeterRailProps } from './MeterRail'
export { DeltaBadge, type DeltaBadgeProps } from './DeltaBadge'
export { DotSeries, type DotSeriesProps } from './DotSeries'
export { LivePill, type LivePillProps } from './LivePill'
export {
  DarkMetricCard,
  type DarkMetricCardProps,
  type DarkMetricCardMeter,
} from './DarkMetricCard'
