/**
 * Primitives Showcase — Phase A QA surface
 * ----------------------------------------
 * Visible at `/__primitives` in dev AND in any environment — but the
 * route is NOT linked from the main navigation. Treat it as an
 * internal dogfooding page: if Phase A's tokens/primitives are wrong,
 * you'll see it here before it contaminates real screens.
 *
 * Build rule: this page must ONLY import from `src/components/primitives/*`
 * or `lucide-react` or Jordan tokens. No shadcn primitives. No app
 * business logic, no React Query, no Supabase.
 */

import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Inbox,
  Mail,
  Plus,
  SlidersHorizontal,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-react'
import {
  ActivityIcon,
  CommandPalette,
  DataTable,
  DraftTypeBadge,
  EmptyState,
  ErrorAlert,
  FacetBar,
  FieldRow,
  KbdHint,
  MetricNumber,
  PageHeader,
  ScoreBadge,
  SkeletonBlock,
  SkeletonCard,
  SkeletonRow,
  SortHeader,
  StatusPill,
  type ColumnDef,
  type CommandItem,
  type RowDensity,
  type SortDirection,
} from '@/components/primitives'

type DemoRow = {
  id: string
  name: string
  venue: string
  score: number
  value: number
  lastTouched: string
}

const DEMO_ROWS: DemoRow[] = [
  { id: '1', name: 'Amelia Chen',   venue: 'Grand Pacific Dining', score: 82, value: 24000, lastTouched: '2d' },
  { id: '2', name: 'Marcus Ortega', venue: 'Laneway & Co.',        score: 61, value: 8800,  lastTouched: '5d' },
  { id: '3', name: 'Priya Shah',    venue: 'The Boathouse',        score: 47, value: 15200, lastTouched: '1w' },
  { id: '4', name: 'Jamie Waititi', venue: 'Northside Events',     score: 34, value: 3400,  lastTouched: '3w' },
  { id: '5', name: 'Linh Tran',     venue: 'Ember Cocktail Bar',   score: 72, value: 11200, lastTouched: '4d' },
  { id: '6', name: 'Owen Fitzroy',  venue: 'Summerhall Cafe',      score: null as unknown as number, value: 0, lastTouched: '—' },
]

const COLUMNS: ColumnDef<DemoRow>[] = [
  { id: 'name',    header: 'Contact',       cell: (r) => <span className="font-medium text-ink">{r.name}</span>, width: 'minmax(160px, 1.2fr)', sortable: true },
  { id: 'venue',   header: 'Venue',         cell: (r) => <span className="text-ink-muted">{r.venue}</span>,       width: 'minmax(160px, 1.5fr)' },
  { id: 'score',   header: 'Score',         cell: (r) => <ScoreBadge score={r.score} />,                          width: '80px', align: 'left' },
  { id: 'value',   header: 'Deal Value',    cell: (r) => <MetricNumber value={r.value} format="currency" />,       width: '120px', numeric: true, align: 'right', sortable: true },
  { id: 'touch',   header: 'Last Touched',  cell: (r) => <span className="text-ink-faint">{r.lastTouched}</span>,  width: '120px', align: 'right' },
]

function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        <a href={`#${id}`} className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint hover:text-ink-muted">
          #{id}
        </a>
      </div>
      {description && <p className="text-[13px] text-ink-muted">{description}</p>}
      <div className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 p-4 space-y-4">
        {children}
      </div>
    </section>
  )
}

function Swatch({ name, value }: { name: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--jordan-radius-sm)] border border-hairline bg-surface-2 p-2">
      <span className="size-6 rounded-[var(--jordan-radius-sm)] border border-hairline" style={{ background: value }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12px] font-medium text-ink">{name}</span>
        <span className="truncate font-mono text-[11px] text-ink-faint">{value}</span>
      </div>
    </div>
  )
}

export default function PrimitivesPage() {
  // DataTable demo state
  const [sort, setSort] = React.useState<{ columnId: string; direction: SortDirection } | null>({
    columnId: 'value',
    direction: 'desc',
  })
  const [density, setDensity] = React.useState<RowDensity>('default')
  const [selection, setSelection] = React.useState<Record<string, string[]>>({})
  const [search, setSearch] = React.useState('')

  // CommandPalette demo
  const [paletteOpen, setPaletteOpen] = React.useState(false)
  const cmdItems: CommandItem[] = [
    { id: 'contact-1', group: 'Contacts', label: 'Amelia Chen',   hint: 'Grand Pacific Dining', leading: <Users size={14} className="text-ink-faint" /> },
    { id: 'contact-2', group: 'Contacts', label: 'Marcus Ortega', hint: 'Laneway & Co.',        leading: <Users size={14} className="text-ink-faint" /> },
    { id: 'deal-1',    group: 'Deals',    label: 'Spring tasting · $24,000', leading: <Sparkles size={14} className="text-ink-faint" /> },
    { id: 'page-1',    group: 'Pages',    label: 'Go to Dashboard',          leading: <ArrowRight size={14} className="text-ink-faint" />,    trailing: <KbdHint>G D</KbdHint> },
    { id: 'page-2',    group: 'Pages',    label: 'Go to Pipeline',           leading: <ArrowRight size={14} className="text-ink-faint" />,    trailing: <KbdHint>G P</KbdHint> },
  ]

  // FieldRow demo
  const [tier, setTier] = React.useState('Hot')
  const [notes, setNotes] = React.useState('Met at trade show; follow up Q2.')

  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
        <PageHeader
          eyebrow="Phase A · Internal"
          title="Primitives Showcase"
          description="Dogfooding page for the Jordan re-skin foundation. Every primitive renders here so token or API regressions surface before they hit production screens."
          actions={
            <>
              <Link
                to="/dashboard"
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--jordan-radius-sm)] border border-hairline px-2.5 text-[13px] text-ink-muted hover:bg-surface-3"
              >
                <ArrowLeft size={14} /> Back to app
              </Link>
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                className="inline-flex h-8 items-center gap-1.5 rounded-[var(--jordan-radius-sm)] bg-[var(--jordan-accent)] px-2.5 text-[13px] font-medium text-white hover:bg-[var(--jordan-accent-hover)]"
              >
                <Sparkles size={14} /> Open ⌘K demo
              </button>
            </>
          }
        />

        {/* ─── TOKENS ───────────────────────────────────────────── */}
        <Section id="tokens-colour" title="Design tokens — colour">
          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Neutrals / hairline / surfaces</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              <Swatch name="ink"            value="var(--jordan-ink)" />
              <Swatch name="ink-muted"      value="var(--jordan-ink-muted)" />
              <Swatch name="ink-subtle"     value="var(--jordan-ink-subtle)" />
              <Swatch name="ink-faint"      value="var(--jordan-ink-faint)" />
              <Swatch name="ink-disabled"   value="var(--jordan-ink-disabled)" />
              <Swatch name="hairline"       value="var(--jordan-hairline)" />
              <Swatch name="surface-1"      value="var(--jordan-surface-1)" />
              <Swatch name="surface-2"      value="var(--jordan-surface-2)" />
              <Swatch name="surface-3"      value="var(--jordan-surface-3)" />
              <Swatch name="surface-4"      value="var(--jordan-surface-4)" />
              <Swatch name="canvas"         value="var(--jordan-canvas)" />
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Accent (single, surgical)</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              <Swatch name="accent"       value="var(--jordan-accent)" />
              <Swatch name="accent-hover" value="var(--jordan-accent-hover)" />
              <Swatch name="accent-soft"  value="var(--jordan-accent-soft)" />
            </div>
          </div>

          <div>
            <div className="mb-2 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Semantic tones</div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
              <Swatch name="hot"     value="var(--jordan-hot)" />
              <Swatch name="warm"    value="var(--jordan-warm)" />
              <Swatch name="cold"    value="var(--jordan-cold)" />
              <Swatch name="success" value="var(--jordan-success)" />
              <Swatch name="warning" value="var(--jordan-warning)" />
              <Swatch name="danger"  value="var(--jordan-danger)" />
            </div>
          </div>
        </Section>

        <Section id="tokens-type" title="Design tokens — typography" description="Inter Variable for prose; JetBrains Mono Variable for all numbers. tnum enabled by default on the mono family.">
          <div className="space-y-1 font-sans text-ink">
            <div className="text-[24px] leading-8 font-semibold">Empty-state hero · 24px</div>
            <div className="text-[20px] leading-7 font-semibold">Page heading · 20px</div>
            <div className="text-[17px] leading-6 font-semibold">Entity name · 17px</div>
            <div className="text-[15px] leading-6">Detail body · 15px</div>
            <div className="text-[14px] leading-[22px]">Form / nav · 14px</div>
            <div className="text-[13px] leading-5">Body / table · 13px</div>
            <div className="text-[11px] leading-4 uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
              Label / column header · 11px · tracking-label
            </div>
            <div className="text-[10px] uppercase tracking-[var(--jordan-tracking-section)] text-ink-faint">
              Section / small-caps · 10px · tracking-section
            </div>
            <div className="pt-3 font-mono text-[13px] jordan-tnum">
              Mono + tnum · 1,234,567.89 · $24,000 · 82%
            </div>
          </div>
        </Section>

        {/* ─── PILL / BADGE FAMILY ─────────────────────────────── */}
        <Section id="status-pill" title="StatusPill" description="18px tall · 11px text · 3px radius. One pill, eight tones.">
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="hot" uppercase>Hot</StatusPill>
            <StatusPill tone="warm" uppercase>Warm</StatusPill>
            <StatusPill tone="cold" uppercase>Cold</StatusPill>
            <StatusPill tone="success" uppercase>Won</StatusPill>
            <StatusPill tone="warning" uppercase>Overdue</StatusPill>
            <StatusPill tone="danger" uppercase>Lost</StatusPill>
            <StatusPill tone="accent" uppercase>Active</StatusPill>
            <StatusPill tone="neutral" uppercase>Draft</StatusPill>
          </div>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="success" dot>Connected</StatusPill>
            <StatusPill tone="warning" dot>Syncing</StatusPill>
            <StatusPill tone="danger" dot>Error</StatusPill>
          </div>
        </Section>

        <Section id="score-badge" title="ScoreBadge + DraftTypeBadge">
          <div className="flex flex-wrap items-center gap-2">
            <ScoreBadge score={84} withLabel />
            <ScoreBadge score={58} withLabel />
            <ScoreBadge score={22} withLabel />
            <ScoreBadge score={84} />
            <ScoreBadge score={null} />
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <DraftTypeBadge type="cold_outreach" />
            <DraftTypeBadge type="follow_up" />
            <DraftTypeBadge type="reply" />
            <DraftTypeBadge type="nudge" />
            <DraftTypeBadge type="re_engagement" />
            <DraftTypeBadge type="proposal" />
          </div>
        </Section>

        <Section id="metric-number" title="MetricNumber">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="space-y-1"><div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Number</div><MetricNumber value={12_345} className="text-[15px]" /></div>
            <div className="space-y-1"><div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Currency</div><MetricNumber value={24_000} format="currency" className="text-[15px]" /></div>
            <div className="space-y-1"><div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Percent</div><MetricNumber value={0.184} format="percent" className="text-[15px]" /></div>
            <div className="space-y-1"><div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Compact</div><MetricNumber value={1_234_000} format="compact" className="text-[15px]" /></div>
            <div className="space-y-1"><div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Signed +</div><MetricNumber value={321} format="signed" className="text-[15px] text-[var(--jordan-success-text)]" /></div>
            <div className="space-y-1"><div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Signed −</div><MetricNumber value={-78} format="signed" className="text-[15px] text-[var(--jordan-danger-text)]" /></div>
            <div className="space-y-1"><div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Null</div><MetricNumber value={null} className="text-[15px]" /></div>
            <div className="space-y-1"><div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Sans</div><MetricNumber value={12_345} sans className="text-[15px] font-medium" /></div>
          </div>
        </Section>

        <Section id="kbd-hint" title="KbdHint">
          <div className="flex flex-wrap gap-4">
            <KbdHint label="Approve">A</KbdHint>
            <KbdHint label="Edit">E</KbdHint>
            <KbdHint label="Skip">S</KbdHint>
            <KbdHint label="Reject">R</KbdHint>
            <KbdHint label="Next">N</KbdHint>
            <KbdHint label="Command palette">⌘K</KbdHint>
          </div>
        </Section>

        {/* ─── FEEDBACK STATES ─────────────────────────────────── */}
        <Section id="skeletons" title="Skeleton family">
          <div className="space-y-3">
            <div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">SkeletonRow (32px, 5 columns)</div>
            <div className="overflow-hidden rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonRow key={i} columns={5} />
              ))}
            </div>
            <div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint pt-2">SkeletonBlock (for KPI tiles)</div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SkeletonBlock height={72} />
              <SkeletonBlock height={72} />
              <SkeletonBlock height={72} />
              <SkeletonBlock height={72} />
            </div>
            <div className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint pt-2">SkeletonCard (with + without avatar)</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <SkeletonCard withAvatar lines={3} />
              <SkeletonCard lines={4} />
            </div>
          </div>
        </Section>

        <Section id="empty-state" title="EmptyState">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1">
              <EmptyState
                icon={Inbox}
                title="No drafts to review"
                body="Jordan will surface new drafts here as soon as they land. Try generating one from a warm lead."
                action={
                  <button className="inline-flex h-8 items-center gap-1.5 rounded-[var(--jordan-radius-sm)] bg-[var(--jordan-accent)] px-2.5 text-[13px] font-medium text-white hover:bg-[var(--jordan-accent-hover)]">
                    <Plus size={14} /> Generate draft
                  </button>
                }
              />
            </div>
            <div className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1">
              <EmptyState
                compact
                icon={UserPlus}
                title="No matches"
                body="Try widening your filters."
                action={
                  <button className="inline-flex h-7 items-center gap-1 rounded-[var(--jordan-radius-sm)] border border-hairline bg-surface-1 px-2.5 text-[12px] text-ink-muted hover:bg-surface-3">
                    Clear filters
                  </button>
                }
              />
            </div>
          </div>
        </Section>

        <Section id="error-alert" title="ErrorAlert">
          <ErrorAlert title="Couldn't load contacts" error="Supabase returned 503 while fetching /contacts." onRetry={() => window.alert('retry')} />
          <ErrorAlert compact error="Draft failed to save — try again in a moment." onRetry={() => window.alert('retry')} />
        </Section>

        {/* ─── DATA SURFACES ───────────────────────────────────── */}
        <Section id="facet-bar" title="FacetBar">
          <FacetBar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search contacts"
            facets={[
              {
                id: 'tier',
                label: 'Tier',
                mode: 'single',
                options: [
                  { value: 'hot', label: 'Hot', count: 12 },
                  { value: 'warm', label: 'Warm', count: 28 },
                  { value: 'cold', label: 'Cold', count: 71 },
                ],
              },
              {
                id: 'venue',
                label: 'Venue',
                mode: 'multi',
                options: [
                  { value: 'restaurant', label: 'Restaurant' },
                  { value: 'cafe', label: 'Café' },
                  { value: 'hotel', label: 'Hotel' },
                  { value: 'event_space', label: 'Event Space' },
                ],
              },
            ]}
            selection={selection}
            onSelectionChange={(id, vals) => setSelection((prev) => ({ ...prev, [id]: vals }))}
            onClear={() => {
              setSearch('')
              setSelection({})
            }}
            summary={<><MetricNumber value={DEMO_ROWS.length} /> of <MetricNumber value={111} /></>}
          />
        </Section>

        <Section id="data-table" title="DataTable · SortHeader" description="32px row height (Morty-locked). Sticky header. Click a column to toggle sort.">
          <div className="flex items-center gap-2 pb-1">
            <span className="text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Density</span>
            {(['compact', 'default', 'cozy'] as RowDensity[]).map((d) => (
              <button
                key={d}
                onClick={() => setDensity(d)}
                className={`inline-flex h-7 items-center rounded-[var(--jordan-radius-sm)] border px-2 text-[12px] ${
                  density === d
                    ? 'border-[color:var(--jordan-accent)] bg-[var(--jordan-accent-soft)] text-[var(--jordan-accent-hover)]'
                    : 'border-hairline bg-surface-1 text-ink-muted hover:bg-surface-3'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
          <DataTable<DemoRow>
            rows={DEMO_ROWS}
            columns={COLUMNS}
            rowKey={(r) => r.id}
            density={density}
            sort={sort}
            onSortChange={(id) =>
              setSort((s) =>
                s?.columnId === id
                  ? s.direction === 'asc'
                    ? { columnId: id, direction: 'desc' }
                    : null
                  : { columnId: id, direction: 'asc' },
              )
            }
            onRowClick={(r) => window.alert(`Clicked ${r.name}`)}
            ariaLabel="Demo contacts"
          />

          <div className="pt-3 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Empty / loading / error</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <DataTable<DemoRow> rows={[]} columns={COLUMNS} empty={{ title: 'No rows yet', icon: Mail, body: 'Import contacts to get started.' }} />
            <DataTable<DemoRow> rows={undefined} columns={COLUMNS} loading skeletonRows={4} />
            <DataTable<DemoRow> rows={undefined} columns={COLUMNS} error="RLS blocked the query" onRetry={() => window.alert('retry')} />
          </div>

          <div className="pt-3">
            <div className="mb-1 text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">Standalone SortHeader</div>
            <div className="flex items-center gap-4">
              <SortHeader label="Name"  direction={null}  onToggle={() => undefined} />
              <SortHeader label="Score" direction="asc"   onToggle={() => undefined} />
              <SortHeader label="Value" direction="desc"  onToggle={() => undefined} align="right" />
            </div>
          </div>
        </Section>

        <Section id="field-row" title="FieldRow" description="Atlas-style inline edit: 120px label / flexible value. Hover to reveal the pencil.">
          <div className="rounded-[var(--jordan-radius-md)] border border-hairline bg-surface-1 px-3">
            <FieldRow label="Name" value={<span className="font-medium text-ink">Amelia Chen</span>} />
            <FieldRow label="Tier" value={<ScoreBadge score={84} withLabel />}>
              {({ close, commit }) => (
                <div className="flex items-center gap-2">
                  <select
                    value={tier}
                    onChange={(e) => setTier(e.target.value)}
                    className="h-7 rounded-[var(--jordan-radius-sm)] border border-hairline bg-surface-2 px-2 text-[13px] text-ink"
                  >
                    <option>Hot</option>
                    <option>Warm</option>
                    <option>Cold</option>
                  </select>
                  <button
                    onClick={commit}
                    className="h-7 rounded-[var(--jordan-radius-sm)] bg-[var(--jordan-accent)] px-2 text-[12px] font-medium text-white"
                  >
                    Save · {tier}
                  </button>
                  <button onClick={close} className="h-7 rounded-[var(--jordan-radius-sm)] border border-hairline px-2 text-[12px] text-ink-muted">
                    Cancel
                  </button>
                </div>
              )}
            </FieldRow>
            <FieldRow label="Notes" value={<span className="text-ink-muted">{notes}</span>}>
              {({ commit }) => (
                <textarea
                  defaultValue={notes}
                  onBlur={(e) => {
                    setNotes(e.target.value)
                    commit()
                  }}
                  className="w-full rounded-[var(--jordan-radius-sm)] border border-hairline bg-surface-2 p-2 text-[13px] text-ink"
                  rows={3}
                />
              )}
            </FieldRow>
            <FieldRow label="Email (read-only)" value={<span className="text-ink-muted">amelia.chen@grandpacific.example</span>} />
          </div>
        </Section>

        {/* ─── ACTIVITY ICONS ──────────────────────────────────── */}
        <Section id="activity-icon" title="ActivityIcon">
          <div className="flex flex-wrap gap-3">
            {['email_sent', 'email_opened', 'reply_received', 'call_note', 'meeting_note', 'meeting_booked', 'task_completed', 'stage_change', 'deal_created', 'note', 'bounce', 'unsubscribe'].map((t) => (
              <div key={t} className="flex items-center gap-2 rounded-[var(--jordan-radius-sm)] border border-hairline bg-surface-2 px-2 py-1">
                <ActivityIcon type={t} />
                <span className="text-[12px] text-ink-muted">{t}</span>
              </div>
            ))}
          </div>
        </Section>

        {/* ─── COMMAND PALETTE (SHELL) ─────────────────────────── */}
        <Section id="command-palette" title="CommandPalette · Phase E preview" description="Shell only. Real wiring (routes, search, hotkeys) ships in Phase E.">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setPaletteOpen(true)}
              className="inline-flex h-8 items-center gap-2 rounded-[var(--jordan-radius-sm)] border border-hairline bg-surface-1 px-2.5 text-[13px] text-ink-muted hover:bg-surface-3"
            >
              <SlidersHorizontal size={14} />
              Open palette
              <KbdHint>⌘K</KbdHint>
            </button>
            <span className="text-[12px] text-ink-faint">Keyboard: ↑ ↓ Enter Esc</span>
          </div>
          <CommandPalette
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            items={cmdItems}
            onSelect={(i) => window.alert(`Selected ${i.id}`)}
            footer={
              <>
                <KbdHint label="navigate">↑↓</KbdHint>
                <KbdHint label="select">↵</KbdHint>
                <KbdHint label="close">ESC</KbdHint>
              </>
            }
          />
        </Section>

        <footer className="py-12 text-center text-[11px] uppercase tracking-[var(--jordan-tracking-label)] text-ink-faint">
          Jordan Re-skin · Phase A · tokens v1 · primitives v1
        </footer>
      </div>
    </div>
  )
}
