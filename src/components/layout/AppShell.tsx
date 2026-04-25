import { useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  KanbanSquare,
  Users,
  Mail,
  Sun,
  Settings,
  LogOut,
  Menu,
  X,
  Radar,
  MapPin,
  Package,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { CapsLabel, LivePill, MeterRail } from '@/components/primitives'
import { useJordanAnchorMetrics } from '@/lib/queries/dashboard'
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

const NAV_SECTIONS: { id: string; label: string; items: NavItem[] }[] = [
  {
    id: 'sales',
    label: 'Sales',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/pipeline', label: 'Pipeline', icon: KanbanSquare },
      { to: '/reopening-radar', label: 'Reopening Radar', icon: Radar },
      { to: '/catalogue', label: 'Catalogue', icon: Package },
      { to: '/field', label: 'Field Mode', icon: MapPin },
      { to: '/briefing', label: 'Briefing', icon: Sun },
    ],
  },
  {
    id: 'leads',
    label: 'Leads',
    items: [
      { to: '/contacts', label: 'Contacts', icon: Users },
      { to: '/drafts', label: 'Draft Queue', icon: Mail },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [{ to: '/settings', label: 'Settings', icon: Settings }],
  },
]

function NavItems({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 pb-3 space-y-5">
      {NAV_SECTIONS.map((section) => (
        <div key={section.id} className="space-y-1">
          <CapsLabel className="px-3 text-[9px] tracking-[0.12em]">
            {section.label}
          </CapsLabel>
          <div className="space-y-0.5">
            {section.items.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
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

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  const SidebarContent = () => (
    <>
      <div className="p-4">
        <h1 className="text-lg font-semibold tracking-tight">LeadFlow</h1>
        <p className="text-[11px] text-ink-faint">Jordan's Sales Agent</p>
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
    </>
  )

  return (
    <div className="min-h-screen flex bg-[color:var(--jordan-surface-bg)]">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-60 shrink-0 border-r border-hairline bg-surface-1 flex-col">
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-surface-1 border-r border-hairline flex flex-col transition-transform duration-150 lg:hidden',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between p-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">LeadFlow</h1>
            <p className="text-[11px] text-ink-faint">Jordan's Sales Agent</p>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)}>
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
          <Outlet />
        </main>
      </div>
    </div>
  )
}
