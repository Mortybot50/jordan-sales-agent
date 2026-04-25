import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { useAuth } from '@/hooks/useAuth'
import { LoginPage } from '@/pages/LoginPage'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardPage } from '@/pages/DashboardPage'
import { PipelinePage } from '@/pages/PipelinePage'
import { ContactsPage } from '@/pages/ContactsPage'
import { ContactDetailPage } from '@/pages/ContactDetailPage'
import { ContactNewPage } from '@/pages/ContactNewPage'
import { ContactImportPage } from '@/pages/ContactImportPage'
import { DraftsPage } from '@/pages/DraftsPage'
import { ReopeningRadarPage } from '@/pages/ReopeningRadarPage'
import { CataloguePage } from '@/pages/CataloguePage'
import { FieldPage } from '@/pages/FieldPage'
import { BriefingPage } from '@/pages/BriefingPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { SuppressionListPage } from '@/pages/SuppressionListPage'
import PrimitivesPage from '@/pages/_primitives'

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        {/* Phase A internal surface — not linked from the main nav. */}
        <Route path="/__primitives" element={<PrimitivesPage />} />
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
          <Route path="reopening-radar" element={<ReopeningRadarPage />} />
          <Route path="catalogue" element={<CataloguePage />} />
          <Route path="field" element={<FieldPage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="contacts/new" element={<ContactNewPage />} />
          <Route path="contacts/import" element={<ContactImportPage />} />
          <Route path="contacts/:id" element={<ContactDetailPage />} />
          <Route path="drafts" element={<DraftsPage />} />
          <Route path="briefing" element={<BriefingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/suppression-list" element={<SuppressionListPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
