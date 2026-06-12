import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { useAuth } from '@/hooks/useAuth'
import { supabase } from '@/lib/supabase'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoginPage } from '@/pages/LoginPage'
import { AppShell } from '@/components/layout/AppShell'
import { DashboardPage } from '@/pages/DashboardPage'
import { PipelinePage } from '@/pages/PipelinePage'
import { ContactsPage } from '@/pages/ContactsPage'
import { ContactDetailPage } from '@/pages/ContactDetailPage'
import { ContactNewPage } from '@/pages/ContactNewPage'
import { DraftsPage } from '@/pages/DraftsPage'
import { SequencesPage } from '@/pages/SequencesPage'
import { SequenceEditPage } from '@/pages/SequenceEditPage'
import { VenueGroupsPage } from '@/pages/VenueGroupsPage'
import { ReopeningRadarPage } from '@/pages/ReopeningRadarPage'
import { CataloguePage } from '@/pages/CataloguePage'
import { BriefingPage } from '@/pages/BriefingPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { EmailAccountsPage } from '@/pages/Settings/EmailAccountsPage'
import { SuppressionListPage } from '@/pages/SuppressionListPage'
import { PrivacyPolicyPage } from '@/pages/PrivacyPolicyPage'
import { UnsubscribePage } from '@/pages/UnsubscribePage'

// Heavy / rarely-visited routes are code-split so the first paint of the
// daily surfaces (dashboard, pipeline, contacts, drafts) doesn't pay for
// maplibre-gl, CSV parsing, analytics or admin tooling.
const FieldPage = lazy(() => import('@/pages/FieldPage').then((m) => ({ default: m.FieldPage })))
const RoutePage = lazy(() => import('@/pages/RoutePage').then((m) => ({ default: m.RoutePage })))
const SourcingPage = lazy(() => import('@/pages/SourcingPage').then((m) => ({ default: m.SourcingPage })))
const LeadsInboxPage = lazy(() => import('@/pages/LeadsInboxPage').then((m) => ({ default: m.LeadsInboxPage })))
const ContactImportPage = lazy(() => import('@/pages/ContactImportPage').then((m) => ({ default: m.ContactImportPage })))
const SalesforceCsvImportPage = lazy(() => import('@/pages/SalesforceCsvImportPage').then((m) => ({ default: m.SalesforceCsvImportPage })))
const SendingPage = lazy(() => import('@/pages/Analytics/SendingPage').then((m) => ({ default: m.SendingPage })))
const SeedTestPage = lazy(() => import('@/pages/Settings/SeedTestPage').then((m) => ({ default: m.SeedTestPage })))
const PostmasterToolsPage = lazy(() => import('@/pages/Settings/PostmasterToolsPage').then((m) => ({ default: m.PostmasterToolsPage })))
const AdminWorkersPage = lazy(() => import('@/pages/AdminWorkersPage').then((m) => ({ default: m.AdminWorkersPage })))
const PrimitivesPage = lazy(() => import('@/pages/_primitives'))

function RouteFallback() {
  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-muted-foreground text-sm">Loading…</div>
    </div>
  )
}

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { session, user, loading, profileError } = useAuth()

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

  // Authenticated session but no usable app profile (fetch error or no users
  // row). Never render the app shell against user=null — downstream queries
  // would all break silently. Offer a recoverable retry + sign-out instead.
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          {profileError
            ? 'We couldn’t load your account just now. This is usually a brief network or connection hiccup.'
            : 'Your sign-in worked, but we couldn’t find your account profile. Try signing in again, or contact support if this keeps happening.'}
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Retry
          </button>
          <button
            onClick={() => { void supabase.auth.signOut().then(() => window.location.replace('/login')) }}
            className="rounded-md border px-4 py-2 text-sm font-medium"
          >
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <ErrorBoundary label="Login page">
              <LoginPage />
            </ErrorBoundary>
          }
        />
        {/* Public privacy policy — required for Google OAuth verification */}
        <Route
          path="/privacy"
          element={
            <ErrorBoundary label="Privacy page">
              <PrivacyPolicyPage />
            </ErrorBoundary>
          }
        />
        {/* Public unsubscribe page — Spam Act 2003 compliance */}
        <Route
          path="/unsubscribe"
          element={
            <ErrorBoundary label="Unsubscribe page">
              <UnsubscribePage />
            </ErrorBoundary>
          }
        />
        {/* Phase A internal surface — not linked from the main nav. */}
        <Route
          path="/__primitives"
          element={
            <Suspense fallback={<RouteFallback />}>
              <PrimitivesPage />
            </Suspense>
          }
        />
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
          <Route path="route" element={<RoutePage />} />
          <Route path="contacts" element={<ContactsPage />} />
          <Route path="contacts/new" element={<ContactNewPage />} />
          <Route path="contacts/import" element={<ContactImportPage />} />
          <Route path="import/contacts" element={<SalesforceCsvImportPage />} />
          <Route path="contacts/:id" element={<ContactDetailPage />} />
          <Route path="drafts" element={<DraftsPage />} />
          <Route path="sequences" element={<SequencesPage />} />
          <Route path="sequences/:id" element={<SequenceEditPage />} />
          <Route path="sourcing" element={<SourcingPage />} />
          <Route path="leads/inbox" element={<LeadsInboxPage />} />
          <Route path="venue-groups" element={<VenueGroupsPage />} />
          <Route path="briefing" element={<BriefingPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="settings/email-accounts" element={<EmailAccountsPage />} />
          <Route path="settings/seed-test" element={<SeedTestPage />} />
          <Route path="settings/postmaster-tools" element={<PostmasterToolsPage />} />
          <Route path="analytics/sending" element={<SendingPage />} />
          <Route path="settings/suppression-list" element={<SuppressionListPage />} />
          <Route path="admin/workers" element={<AdminWorkersPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
      <Toaster />
    </BrowserRouter>
  )
}
