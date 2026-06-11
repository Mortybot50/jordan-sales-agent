import { Suspense, useState, useSyncExternalStore } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { ClaudeCommandBar } from '@/components/claude/ClaudeCommandBar'
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  Mail,
  Send,
  Sun,
  Settings,
  LogOut,
  Menu,
  X,
  Radar,
  MapPin,
  Route as RouteIcon,
  Package,
  Upload,
  Workflow,
  Compass,
  Building2,
  BarChart3,
  ShieldOff,
  Activity,
  Inbox,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { canAdmin } from '@/lib/auth'
import { useAuth } from '@/hooks/useAuth'
import { Button } from '@/components/ui/button'
import { CapsLabel, LivePill, MeterRail } from '@/components/primitives'
import { useJordanAnchorMetrics } from '@/lib/queries/dashboard'
import { useDraftQueueCount } from '@/lib/queries/drafts'
import {
  JORDAN_MEETINGS_WEEKLY_TARGET_MIN,
  JORDAN_MEETINGS_WEEKLY_TARGET_MAX,
} from '@/lib/metrics/jordanScore'
import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
}

const NAV_SECTIONS: { id: string; label: string; adminOnly?: boolean; items: NavItem[] }[] = [
  {
    id: 'crm',
    label: 'CRM',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
      { to: '/contacts', label: 'Contacts', icon: Users },
      { to: '/venue-groups', label: 'Venue Groups', icon: Building2 },
      { to: '/catalogue', label: 'Catalogue', icon: Package },
      { to: '/field', label: 'Field Mode', icon: MapPin },
      { to: '/route', label: 'Call Cycle', icon: RouteIcon },
    ],
  },
  {
    id: 'outbound',
    label: 'Outbound',
    items: [
      { to: '/drafts', label: 'Draft Queue', icon: Mail },
      { to: '/sequences', label: 'Sequences', icon: Workflow },
      { to: '/import/contacts', label: 'Import CSV', icon: Upload },
      { to: '/analytics/sending', label: 'Sending Analytics', icon: BarChart3 },
    ],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    items: [
      { to: '/sourcing', label: 'Sourcing', icon: Compass },
      { to: '/reopening-radar', label: 'Reopening Radar', icon: Radar },
      { to: '/briefing', label: 'Briefing', icon: Sun },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
      { to: '/settings/email-accounts', label: 'Email inboxes', icon: Send },
      { to: '/settings/suppression-list', label: 'Suppression list', icon: ShieldOff },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    adminOnly: true,
    items: [
      { to: '/admin/workers', label: 'Workers', icon: Activity },
      { to: '/settings/postmaster-tools', label: 'Postmaster Tools', icon: Inbox },
    ],
  },
]

function DraftQueueBadge() {
  const { data } = useDraftQueueCount()
  const total = data?.total ?? 0
  const needsDiary = data?.needsDiary ?? 0
  if (total <= 0) return null

  // Mint for a healthy queue, amber once it backs up — no new colours,
  // both are existing Dark Anchor accents.
  const tone = total >= 6 ? 'amber' : 'mint'
  const showSplit = needsDiary > 0 && total > needsDiary

  return (
    <span
      data-testid="draft-queue-count"
      data-needs-diary={needsDiary > 0 || undefined}
      className={cn(
        'ml-auto inline-flex items-center gap-0.5 h-[18px] rounded-full text-[10px] font-semibold tracking-[0.08em] tabular-nums jordan-tnum',
        showSplit ? 'pl-1.5 pr-0' : 'px-1.5 justify-center min-w-[20px]',
        tone === 'mint'
          ? 'bg-[color:var(--jordan-accent-mint-soft)] text-[color:var(--jordan-success-text)]'
          : 'bg-[color:var(--jordan-warm-soft)] text-[color:var(--jordan-warm-text)]',
      )}
      aria-label={
        needsDiary > 0
          ? `${total} draft${total === 1 ? '' : 's'} awaiting review, ${needsDiary} need${needsDiary === 1 ? 's' : ''} your diary`
          : `${total} draft${total === 1 ? '' : 's'} awaiting review`
      }
    >
      {showSplit ? (
        <>
          <span>{total > 99 ? '99+' : total}</span>
          <span
            className="ml-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[color:var(--jordan-warm-soft)] px-1.5 text-[color:var(--jordan-warm-text)]"
            title={`${needsDiary} need${needsDiary === 1 ? 's' : ''} your diary`}
          >
            {needsDiary > 99 ? '99+' : needsDiary}
          </span>
        </>
      ) : (
        <span>{total > 99 ? '99+' : total}</span>
      )}
    </span>
  )
}

// Precompute, per nav item, whether any other nav item is a child route of it.
// Settings (/settings) has a sibling Email inboxes (/settings/email-accounts);
// without `end` the parent stayed lit on every child route alongside the
// child. NavLink's `end` prop forces an exact pathname match for those.
const NAV_ITEMS_FLAT = NAV_SECTIONS.flatMap((s) => s.items)
function hasChildRoute(to: string): boolean {
  return NAV_ITEMS_FLAT.some((other) => other.to !== to && other.to.startsWith(`${to}/`))
}

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const sections = NAV_SECTIONS.filter((s) => !s.adminOnly || canAdmin(user))
  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-5">
      {sections.map((section) => (
        <div key={section.id} className="space-y-1">
          <CapsLabel className="px-3 text-[9px] tracking-[0.12em]">
            {section.label}
          </CapsLabel>
          <div className="space-y-0.5">
            {section.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={hasChildRoute(to)}
                onClick={onNavigate}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 px-3 py-2 rounded-[6px] text-sm transition-colors',
                    isActive
                      ? 'bg-[color:var(--jordan-accent-soft)] text-[color:var(--jordan-accent-hover)] font-medium'
                      : 'text-ink-muted hover:text-ink hover:bg-surface-3',
                  )
                }
              >
                <Icon className="size-4 shrink-0" />
                <span>{label}</span>
                {to === '/drafts' && <DraftQueueBadge />}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  )
}

function TargetWidget() {
  const { data, isLoading } = useJordanAnchorMetrics()
  const count = data?.qualifiedMeetingsCount ?? 0
  const filled = Math.min(JORDAN_MEETINGS_WEEKLY_TARGET_MAX, count)
  const tone = data?.qualifiedMeetingsTone ?? 'mint'

  return (
    <div className="mx-3 rounded-[10px] bg-[color:var(--jordan-ink)] text-white p-4 flex flex-col gap-3 border border-[color:var(--jordan-dark-border)]">
      <div className="flex items-start justify-between gap-2">
        <CapsLabel tone="onDark" className="text-[color:var(--jordan-dark-faint)]">
          This week's target
        </CapsLabel>
        {filled > 0 && <LivePill label="Active" tone="onDark" />}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[22px] leading-none font-semibold jordan-tnum">
          {isLoading ? '—' : count}
        </span>
        <span className="text-[13px] text-[color:var(--jordan-dark-muted)] jordan-tnum">
          / {JORDAN_MEETINGS_WEEKLY_TARGET_MIN}–{JORDAN_MEETINGS_WEEKLY_TARGET_MAX} meetings
        </span>
      </div>
      <MeterRail
        segments={JORDAN_MEETINGS_WEEKLY_TARGET_MAX}
        filled={filled}
        tone={tone}
        ariaLabel="Weekly qualified meetings progress"
      />
    </div>
  )
}

export function AppShell() {
  const [mobileOpen, setMobileOpen] = useState(false)
  // Track the lg breakpoint (Tailwind lg = 1024px) so the off-canvas drawer can
  // be made truly inert (not just translated offscreen) on mobile when closed,
  // while staying fully interactive on desktop where it's a static column.
  // useSyncExternalStore subscribes to matchMedia without a setState-in-effect
  // (which React's lint flags as a cascading-render risk).
  const isDesktop = useSyncExternalStore(
    (onStoreChange) => {
      const mq = window.matchMedia('(min-width: 1024px)')
      mq.addEventListener('change', onStoreChange)
      return () => mq.removeEventListener('change', onStoreChange)
    },
    () => window.matchMedia('(min-width: 1024px)').matches,
    () => true, // no SSR in this Vite SPA; default to desktop for the server snapshot
  )
  // Hidden to assistive tech + keyboard only when it's the closed mobile drawer.
  const drawerHidden = !isDesktop && !mobileOpen
  const location = useLocation()

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-screen flex bg-[color:var(--jordan-surface-bg)]">
      {/* Mobile overlay — only renders while drawer is open and only at <lg */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Single sidebar — behaves as a fixed slide-in drawer on mobile and a
          static flex column on desktop. Previously this lived as two separate
          <aside> regions which left a duplicate <nav> in the DOM at every
          viewport and made screen-reader / Cmd-F output redundant. */}
      <aside
        aria-hidden={drawerHidden || undefined}
        inert={drawerHidden || undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-hairline bg-surface-1 transition-transform duration-150',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'lg:static lg:z-auto lg:w-60 lg:shrink-0 lg:translate-x-0 lg:transition-none',
        )}
      >
        <div className="flex items-start justify-between p-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">LeadFlow</h1>
            <p className="text-[11px] text-ink-faint">Jordan's Sales Agent</p>
          </div>
          {/* Close button — mobile drawer only */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileOpen(false)}
            className="lg:hidden"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </Button>
        </div>

        <div className="pb-4">
          <TargetWidget />
        </div>

        <NavItems onNavigate={() => setMobileOpen(false)} />

        <div className="p-3 border-t border-hairline">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-center gap-2 rounded-full h-9 border-hairline text-ink-muted hover:text-ink hover:bg-surface-3"
            onClick={handleSignOut}
          >
            <LogOut className="size-4" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center gap-3 px-4 h-14 border-b border-hairline bg-surface-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(true)}>
            <Menu className="size-5" />
          </Button>
          <span className="font-semibold text-sm">LeadFlow</span>
        </header>

        <main className="flex-1 overflow-auto">
          <ErrorBoundary label={`Route (${location.pathname})`} resetKey={location.pathname}>
            <Suspense
              fallback={
                <div className="flex items-center justify-center min-h-[50vh]">
                  <div className="text-muted-foreground text-sm">Loading…</div>
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      {/* Global Cmd+K Claude command bar — mounted inside AppShell so it
          only exists when the user is authenticated (RequireAuth wraps the
          shell in App.tsx). */}
      <ClaudeCommandBar />
    </div>
  )
}
