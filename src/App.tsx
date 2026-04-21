import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
// import { useAuth } from '@/hooks/useAuth' // TODO(auth): restore when re-enabling auth gate
import { LoginPage } from '@/pages/LoginPage'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardPage } from '@/pages/DashboardPage'
import { PipelinePage } from '@/pages/PipelinePage'
import { ContactsPage } from '@/pages/ContactsPage'
import { DraftsPage } from '@/pages/DraftsPage'
import { BriefingPage } from '@/pages/BriefingPage'
import { SettingsPage } from '@/pages/SettingsPage'

// TODO(auth): re-enable auth gate before production release
// Auth is temporarily bypassed for dev/demo — remove the early return below to restore.
function RequireAuth({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="pipeline" element={<PipelinePage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="drafts" element={<DraftsPage />} />
          <Route path="briefing" element={<BriefingPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
