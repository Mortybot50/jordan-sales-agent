import { useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { supabase } from '@/lib/supabase'
import { Sentry } from '@/lib/sentry'
import {
  buildReauthUrl,
  isCorruptCachedSessionBlob,
  isReauthAttempt,
  stripReauthFlag,
} from '@/lib/auth-recovery'
import type { Session } from '@supabase/supabase-js'

export interface AppUser {
  id: string
  email: string
  org_id: string
  full_name: string | null
  role: string
  email_signature: string | null
  voice_rules: string | null
  icp_config: Record<string, unknown>
  email_notifications: {
    morning_briefing: boolean
    briefing_time_hour: number
    morning_briefing_paused_until?: string | null
  }
  default_commission_pct: number | null
  notify_whatsapp_e164: string | null
  notify_warm_replies: boolean
  notify_quiet_hours_start: number | null
  notify_quiet_hours_end: number | null
}

export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'authenticated'
  | 'error'

export type AuthErrorReason = 'profile-fetch-failed' | 'profile-missing' | null

interface AuthState {
  session: Session | null
  user: AppUser | null
  /** True iff `status === 'loading'`. Kept for backwards compatibility with the
   *  pre-state-machine callers (29 consumers across the app); new code should
   *  switch on `status` directly. */
  loading: boolean
  /** True iff `status === 'error'`. Backwards-compat alias — same caveat. */
  profileError: boolean
  status: AuthStatus
  errorReason: AuthErrorReason
}

// Hard caps. These define the "fail-closed" contract: from a cold mount, the
// app reaches an authenticated, unauthenticated, or error state within
// `SESSION_RESTORE_HARD_CAP_MS + PROFILE_FETCH_HARD_CAP_MS` (~14s worst case),
// not "loading" forever. PR #99 added the first cap; the second is added here
// after Jordan reported permanent "Loading…" surviving the #99 fix — a profile
// fetch that hangs after INITIAL_SESSION has the same UX as an SDK init hang.
const SESSION_RESTORE_HARD_CAP_MS = 8_000
const PROFILE_FETCH_HARD_CAP_MS = 6_000

interface AuthSnapshot {
  status: AuthStatus
  session: Session | null
  user: AppUser | null
  errorReason: AuthErrorReason
}

const INITIAL_SNAPSHOT: AuthSnapshot = {
  status: 'loading',
  session: null,
  user: null,
  errorReason: null,
}

// Module-singleton state. ONE subscription, ONE hard cap, ONE profile fetch
// in flight across the whole app — every useAuth() consumer reads the same
// snapshot through useSyncExternalStore. Replaces the per-component pattern
// where each of 29 useAuth() callsites spun up its own onAuthStateChange
// subscription, its own timer, and its own profile fetch — wasteful at best,
// race-prone at worst.
let snapshot: AuthSnapshot = INITIAL_SNAPSHOT
const listeners = new Set<() => void>()

function setSnapshot(next: AuthSnapshot): void {
  if (
    next.status === snapshot.status &&
    next.session === snapshot.session &&
    next.user === snapshot.user &&
    next.errorReason === snapshot.errorReason
  ) {
    return
  }
  snapshot = next
  listeners.forEach((l) => l())
}

let initStartedAt = 0
let initialized = false
let hardCapTimer: ReturnType<typeof setTimeout> | null = null
let profileFetchTimer: ReturnType<typeof setTimeout> | null = null
let subscription: { unsubscribe: () => void } | null = null
// Each profile fetch increments this; only the latest one is allowed to
// mutate the snapshot when it eventually resolves. Guards against the
// auth-flip-flop race (sign-out fires before a slow profile load returns).
let profileFetchSeq = 0

function clearHardCap(): void {
  if (hardCapTimer !== null) {
    clearTimeout(hardCapTimer)
    hardCapTimer = null
  }
}

function clearProfileTimer(): void {
  if (profileFetchTimer !== null) {
    clearTimeout(profileFetchTimer)
    profileFetchTimer = null
  }
}

function logStep(step: string, extra: Record<string, unknown> = {}): void {
  const elapsedMs = initStartedAt === 0 ? 0 : Date.now() - initStartedAt
  console.error('[useAuth]', step, { elapsed_ms: elapsedMs, ...extra })
  try {
    Sentry.addBreadcrumb({
      category: 'auth',
      message: step,
      level: 'info',
      data: { elapsed_ms: elapsedMs, ...extra },
    })
  } catch {
    // Sentry not initialised (no DSN, dev mode) — breadcrumbs are best-effort.
  }
}

function projectRefFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).host.split('.')[0] || null
  } catch {
    return null
  }
}

// Routes that render WITHOUT going through RequireAuth. The eager
// module-load init runs as soon as App imports useAuth — which means it
// fires on these public pages too. We must NOT redirect a user reading
// the privacy policy or following an unsubscribe link into auth recovery
// just because their localStorage has a stale Supabase blob.
// Kept in sync with the public routes in App.tsx.
const PUBLIC_PATHS = new Set<string>([
  '/login',
  '/privacy',
  '/unsubscribe',
  '/__primitives',
])

function isPublicPath(): boolean {
  if (typeof window === 'undefined') return true
  return PUBLIC_PATHS.has(window.location.pathname)
}

function clearStaleSupabaseAuthStorage(): void {
  if (typeof localStorage === 'undefined') return
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      // Wipe every `sb-*` key, not just `*-auth-token`. PR #99 widened this to
      // cover the PKCE code-verifier alongside the token blob — narrowing it
      // back would leave stale verifiers behind and re-introduce the orphan
      // lock failure mode.
      if (key && key.startsWith('sb-')) {
        localStorage.removeItem(key)
      }
    }
  } catch (err) {
    console.error('[useAuth] localStorage clear failed:', err)
  }
}

type CachedSessionStatus = 'ok' | 'absent' | 'corrupt'

/**
 * Pre-flight inspection of the persisted auth token. Runs BEFORE the first
 * `supabase.auth.*` call — if the cached blob is unparseable, the SDK's
 * `_initialize()` may swallow the parse error and never deliver
 * INITIAL_SESSION, which would otherwise be caught only by the 8s hard cap
 * (a full 8s blank screen). Detecting it here lets us steer to a clean
 * `/login?reset=1` immediately.
 */
function inspectCachedSession(): CachedSessionStatus {
  if (typeof window === 'undefined') return 'absent'
  const ref = projectRefFromUrl(import.meta.env.VITE_SUPABASE_URL)
  if (!ref) return 'absent'
  const key = `sb-${ref}-auth-token`
  let raw: string | null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return 'absent'
  }
  if (raw === null) return 'absent'
  return isCorruptCachedSessionBlob(raw) ? 'corrupt' : 'ok'
}

function redirectToLogin(reason?: 'reset' | 'auth-init-failed'): void {
  if (typeof window === 'undefined') return
  // Allow `/login?reset=1` overlay even if we're already on /login (the user
  // may have a stale tab they're refreshing).
  const target =
    reason === 'reset'
      ? '/login?reset=1'
      : reason === 'auth-init-failed'
        ? '/login?error=auth-init-failed'
        : '/login'
  if (window.location.pathname === '/login' && reason === undefined) return
  window.location.replace(target)
}

type ProfileResult = AppUser | 'error' | null

async function fetchUserProfile(userId: string): Promise<ProfileResult> {
  const { data, error } = await supabase
    .from('users')
    .select('id, org_id, full_name, email, role, email_signature, voice_rules, icp_config, email_notifications, default_commission_pct, notify_whatsapp_e164, notify_warm_replies, notify_quiet_hours_start, notify_quiet_hours_end')
    .eq('id', userId)
    .maybeSingle()

  if (error) return 'error'
  if (!data) return null

  const d = data as unknown as Record<string, unknown>
  return {
    id: d.id as string,
    email: (d.email as string | null) ?? '',
    org_id: d.org_id as string,
    full_name: d.full_name as string | null,
    role: (d.role as string | null) ?? 'member',
    email_signature: d.email_signature as string | null,
    voice_rules: d.voice_rules as string | null,
    icp_config: ((d.icp_config ?? {}) as Record<string, unknown>),
    email_notifications: ((d.email_notifications ?? { morning_briefing: true, briefing_time_hour: 7 }) as {
      morning_briefing: boolean
      briefing_time_hour: number
      morning_briefing_paused_until?: string | null
    }),
    default_commission_pct: d.default_commission_pct == null ? null : Number(d.default_commission_pct),
    notify_whatsapp_e164: (d.notify_whatsapp_e164 as string | null) ?? null,
    notify_warm_replies: (d.notify_warm_replies as boolean | null) ?? true,
    notify_quiet_hours_start: d.notify_quiet_hours_start == null ? null : Number(d.notify_quiet_hours_start),
    notify_quiet_hours_end: d.notify_quiet_hours_end == null ? null : Number(d.notify_quiet_hours_end),
  }
}

/**
 * `mode` controls how profile-fetch failures are surfaced.
 *
 * - `initial`  → first load (no user yet, or different user). On failure
 *                we MUST surface the error UI; the caller has no fallback.
 * - `refresh`  → background refresh after a TOKEN_REFRESHED / USER_UPDATED
 *                event. The current authenticated snapshot is still good;
 *                a failure must NOT disrupt the user — just log and bail.
 */
async function loadProfile(session: Session, mode: 'initial' | 'refresh' = 'initial'): Promise<void> {
  const seq = ++profileFetchSeq
  clearProfileTimer()
  logStep('profile:fetch-start', { userId: session.user.id, seq, mode })

  let timedOut = false
  const timeoutPromise = new Promise<'timeout'>((resolve) => {
    profileFetchTimer = setTimeout(() => {
      timedOut = true
      resolve('timeout')
    }, PROFILE_FETCH_HARD_CAP_MS)
  })

  let result: ProfileResult | 'timeout'
  try {
    result = await Promise.race([fetchUserProfile(session.user.id), timeoutPromise])
  } catch (err) {
    logStep('profile:fetch-threw', { error: String(err), seq, mode })
    result = 'error'
  }
  clearProfileTimer()

  // A newer profile load (or a sign-out clearing currentProfileSeq state)
  // superseded us — discard the stale result so we don't flip back from
  // `unauthenticated` → `authenticated`.
  if (seq !== profileFetchSeq) {
    logStep('profile:fetch-superseded', { seq, current: profileFetchSeq })
    return
  }

  const isFailure =
    timedOut || result === 'timeout' || result === 'error' || result === null

  if (isFailure && mode === 'refresh') {
    // Background refresh failed — keep the existing authenticated snapshot
    // intact. Don't bounce a working app to the error screen for a transient
    // refresh hiccup; the next TOKEN_REFRESHED event will retry.
    logStep('profile:refresh-failed-keeping-state', {
      timedOut,
      result: typeof result === 'string' ? result : result === null ? 'null' : 'profile',
    })
    return
  }

  if (timedOut || result === 'timeout') {
    logStep('profile:fetch-timeout', { cap_ms: PROFILE_FETCH_HARD_CAP_MS })
    setSnapshot({
      status: 'error',
      session,
      user: null,
      errorReason: 'profile-fetch-failed',
    })
    return
  }
  if (result === 'error') {
    logStep('profile:fetch-error')
    setSnapshot({
      status: 'error',
      session,
      user: null,
      errorReason: 'profile-fetch-failed',
    })
    return
  }
  if (result === null) {
    logStep('profile:row-missing')
    setSnapshot({
      status: 'error',
      session,
      user: null,
      errorReason: 'profile-missing',
    })
    return
  }
  logStep('profile:fetched-ok', { mode })
  setSnapshot({
    status: 'authenticated',
    session,
    user: result,
    errorReason: null,
  })
  if (isReauthAttempt()) stripReauthFlag()
}

function onHardCapFire(): void {
  const onPublic = isPublicPath()
  logStep('init:hard-cap-fired', {
    cap_ms: SESSION_RESTORE_HARD_CAP_MS,
    reauthAttempt: isReauthAttempt(),
    isPublic: onPublic,
  })
  clearStaleSupabaseAuthStorage()

  if (onPublic) {
    // On a public page (e.g. /privacy, /unsubscribe). The user isn't trying
    // to use authenticated features — don't drag them through `?reauth=1`
    // or kick them to /login. Silent recovery: cleared blob, unauthenticated
    // snapshot, page keeps rendering.
    logStep('init:hard-cap-silent-recovery-on-public-path')
    setSnapshot({
      status: 'unauthenticated',
      session: null,
      user: null,
      errorReason: null,
    })
    return
  }

  if (isReauthAttempt()) {
    // Second consecutive hang after the `?reauth=1` round-trip — the hard
    // reload didn't break us out, so this is a real auth problem, not a
    // navigator.locks orphan. Bail to /login with an explicit error.
    logStep('init:hard-cap-escalating-to-login')
    toast.error('Session could not be restored, please log in')
    setSnapshot({
      status: 'unauthenticated',
      session: null,
      user: null,
      errorReason: null,
    })
    redirectToLogin('auth-init-failed')
    return
  }
  // First hang — try the hard reload to drop any Web Lock held by this
  // browsing context. There is no app-level API to release another context's
  // lock; the reload is the only standards-compliant recovery.
  logStep('init:hard-cap-reloading-with-reauth')
  toast.message('Refreshing session…')
  if (typeof window !== 'undefined') {
    window.location.replace(buildReauthUrl())
  }
}

function initializeAuth(): void {
  if (initialized) return
  if (typeof window === 'undefined') return
  initialized = true
  initStartedAt = Date.now()

  const cached = inspectCachedSession()
  logStep('init:start', {
    cached,
    reauthAttempt: isReauthAttempt(),
    pathname: window.location.pathname,
  })

  // Corrupt-token tripwire (path A). Detect a malformed cached blob BEFORE
  // the SDK reads it — gotrue's `_initialize()` may swallow the parse error
  // and never deliver INITIAL_SESSION, which would otherwise show 8s of
  // blank "Loading…" before the hard cap recovers it.
  let skipHardCap = false
  if (cached === 'corrupt') {
    const onPublic = isPublicPath()
    logStep('init:corrupt-cached-token', { isPublic: onPublic })
    clearStaleSupabaseAuthStorage()
    setSnapshot({
      status: 'unauthenticated',
      session: null,
      user: null,
      errorReason: null,
    })
    if (!onPublic) {
      // Protected route — kick to /login?reset=1. The hard reload re-runs
      // initializeAuth from scratch on the next page, so no need to wire
      // the subscription on this dying page.
      redirectToLogin('reset')
      return
    }
    // Public route (e.g. /login itself) — fall through to subscribe so the
    // singleton picks up a subsequent SIGNED_IN (from the login form on
    // this very page). Skip the hard cap: storage is already clean, the
    // SDK has nothing to restore, INITIAL_SESSION will fire promptly with
    // null. Arming an 8s timer on top would only fire a spurious
    // recovery path.
    skipHardCap = true
  }

  if (!skipHardCap) {
    hardCapTimer = setTimeout(onHardCapFire, SESSION_RESTORE_HARD_CAP_MS)
  }

  const { data } = supabase.auth.onAuthStateChange((event, s) => {
    logStep('auth:event', { event, hasSession: !!s })
    clearHardCap()

    if (!s?.user) {
      // Cancel any in-flight profile fetch by bumping the sequence.
      profileFetchSeq++
      clearProfileTimer()
      setSnapshot({
        status: 'unauthenticated',
        session: null,
        user: null,
        errorReason: null,
      })
      if (isReauthAttempt()) stripReauthFlag()
      return
    }

    // TOKEN_REFRESHED / USER_UPDATED on an existing authenticated user
    // (~50min cadence by default). Keep the current user snapshot visible
    // and refresh the profile in the background. Without this guard the
    // app blanks to a full-screen "Loading…" on every token refresh while
    // the profile refetch completes — an avoidable mid-session disruption.
    const sameUser =
      snapshot.status === 'authenticated' &&
      snapshot.user !== null &&
      snapshot.user.id === s.user.id

    if (sameUser) {
      setSnapshot({
        status: 'authenticated',
        session: s,
        user: snapshot.user,
        errorReason: null,
      })
      void loadProfile(s, 'refresh')
      return
    }

    // Genuine new session (INITIAL_SESSION on cold mount, SIGNED_IN, or
    // a different user). Optimistic loading snapshot — session is known,
    // profile is loading. Any consumer that needs the session (e.g. a
    // Supabase RLS query) can already proceed; only the full AppUser
    // shape is gated on the fetch.
    setSnapshot({
      status: 'loading',
      session: s,
      user: null,
      errorReason: null,
    })
    void loadProfile(s, 'initial')
  })
  subscription = data.subscription

  // Vite HMR teardown — prevents zombie subscriptions and timers across hot
  // reloads in dev. Production builds don't have import.meta.hot.
  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      logStep('hmr:dispose')
      clearHardCap()
      clearProfileTimer()
      if (subscription) {
        try {
          subscription.unsubscribe()
        } catch {
          // best-effort
        }
        subscription = null
      }
      initialized = false
      profileFetchSeq = 0
      snapshot = INITIAL_SNAPSHOT
      listeners.clear()
      initStartedAt = 0
    })
  }
}

function subscribeListener(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): AuthSnapshot {
  return snapshot
}

// Eager module-load initialisation. Side-effecting at import time is
// deliberate: the alternative — initialising inside the first useAuth()
// render — pushes a redirect during render, which React 19 flags as unsafe.
// `instrumentation.ts` (which initialises Sentry) is imported first in
// main.tsx, so Sentry is ready before this fires.
if (typeof window !== 'undefined') {
  initializeAuth()
}

export function useAuth(): AuthState {
  const s = useSyncExternalStore(subscribeListener, getSnapshot, getSnapshot)
  return {
    session: s.session,
    user: s.user,
    loading: s.status === 'loading',
    profileError: s.status === 'error',
    status: s.status,
    errorReason: s.errorReason,
  }
}
