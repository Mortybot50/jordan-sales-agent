import { NavLink, Outlet } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const NAV_ITEMS = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/contacts', label: 'Contacts' },
  { to: '/drafts', label: 'Draft Queue' },
  { to: '/briefing', label: 'Briefing' },
  // TODO(week-5): Add Sequences nav item once sequence builder is built
  { to: '/settings', label: 'Settings' },
]

export function AppShell() {
  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r bg-sidebar flex flex-col">
        <div className="p-4">
          <h1 className="text-lg font-semibold tracking-tight">LeadFlow</h1>
          <p className="text-xs text-muted-foreground">Jordan's Sales Agent</p>
        </div>
        <Separator />
        <nav className="flex-1 p-3 space-y-1">
          {NAV_ITEMS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
