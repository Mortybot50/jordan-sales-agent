/**
 * Reproduces the 2026-06-09 P0 auth init hang and verifies the fix:
 *   1. SESSION_RESTORE_HARD_CAP_MS shortened from 25s → 8s
 *   2. On hard-cap fire, hard-reload with ?reauth=1 to drop any
 *      navigator.locks lock held by the previous browsing context
 *   3. If the post-reload mount ALSO hangs, escalate to /login
 *
 * Playwright is NOT installed in this repo (devDeps don't include it). This
 * spec ships unrun. To execute locally:
 *
 *   cd ~/.openclaw/roles/dev/jordan-sales-agent
 *   npm install --no-save --save-dev @playwright/test
 *   npx playwright install chromium
 *   # Stand up dev server on http://localhost:5173 in another shell:
 *   #   npm run dev
 *   npx playwright test tests/e2e/auth-init-lock-repro.spec.ts \
 *     --headed \
 *     --config=tests/e2e/playwright.config.ts
 *
 * Playwright config is NOT shipped — wiring it into the repo + CI is a
 * separate PR (the brief explicitly scopes this work to ship the spec only).
 * A minimal local config that works:
 *
 *   // tests/e2e/playwright.config.ts
 *   import { defineConfig } from '@playwright/test'
 *   export default defineConfig({
 *     testDir: '.',
 *     use: { baseURL: process.env.BASE_URL ?? 'http://localhost:5173' },
 *   })
 *
 * Pre-test setup: seed a valid Supabase session into localStorage before the
 * tab loads. Use a known test user with valid org_id. Without a real session,
 * Case A trivially settles (no auth to restore) and Case B can't reproduce
 * gotrue's locked _initialize() path.
 */

import { test, expect, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Fixtures — fill these in before running locally.
// ---------------------------------------------------------------------------

/** Supabase project ref (host prefix). Matches `sb-<ref>-auth-token` storage key. */
const PROJECT_REF = process.env.PROJECT_REF ?? 'bsevgxhnxlkzkcalevbb'

/** Supabase storage key for the auth token. */
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`

/** Web Lock name gotrue's _initialize() awaits. */
const LOCK_NAME = `lock:${STORAGE_KEY}`

/**
 * Stringified Supabase session object. Replace with a real one captured from a
 * working browser session via:
 *   localStorage.getItem('sb-<ref>-auth-token')
 * Must be valid (unexpired access_token) so onAuthStateChange settles INITIAL_SESSION.
 */
const SEEDED_SESSION_JSON = process.env.SEEDED_SESSION_JSON ?? ''

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5173'

/**
 * Wait for the loading screen to clear and the dashboard to render.
 * Adjust the selector if the loading copy / dashboard landmark changes.
 */
async function waitForSettle(page: Page, timeoutMs: number): Promise<'settled' | 'login' | 'timeout'> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const url = new URL(page.url())
    if (url.pathname === '/login') return 'login'
    const loadingVisible = await page.locator('text=Loading…').first().isVisible().catch(() => false)
    if (!loadingVisible) return 'settled'
    await page.waitForTimeout(250)
  }
  return 'timeout'
}

test.beforeEach(async ({ page }) => {
  test.skip(!SEEDED_SESSION_JSON, 'SEEDED_SESSION_JSON env var not set — see file header for instructions')
  await page.goto(BASE_URL)
  await page.evaluate(
    ({ key, json }) => {
      localStorage.setItem(key, json)
    },
    { key: STORAGE_KEY, json: SEEDED_SESSION_JSON },
  )
})

// ---------------------------------------------------------------------------
// Case A — single tab, valid session, hard refresh.
//   Expected (with and without fix): settles within ~10s, lands on dashboard.
// ---------------------------------------------------------------------------

test('Case A: single tab, valid persisted session, hard refresh → settles', async ({ page }) => {
  await page.goto(BASE_URL)
  const result = await waitForSettle(page, 10_000)
  expect(result).toBe('settled')

  // Should NOT have triggered the recovery path on a clean restore.
  const url = new URL(page.url())
  expect(url.searchParams.get('reauth')).toBeNull()
})

// ---------------------------------------------------------------------------
// Case B — Tab 1 holds the auth lock; Tab 2 hard refreshes.
//   Expected with fix: Tab 2 settles within ~12s (8s hard cap + reload).
//   Expected without fix: Tab 2 hangs indefinitely.
// ---------------------------------------------------------------------------

test('Case B: cross-tab Web Lock held → hard-cap fires + reload recovers', async ({ context }) => {
  const tab1 = await context.newPage()
  await tab1.goto(BASE_URL)

  // Tab 1: acquire the auth lock and hold it forever. gotrue in Tab 2 will
  // await this lock inside _initialize() and never resolve.
  await tab1.evaluate(
    (lockName) => {
      // Don't await — we want the lock held for the lifetime of tab1.
      void navigator.locks.request(lockName, { mode: 'exclusive' }, () => new Promise<void>(() => {}))
    },
    LOCK_NAME,
  )

  // Give the lock a beat to be acquired.
  await tab1.waitForTimeout(500)

  const tab2 = await context.newPage()
  const start = Date.now()
  await tab2.goto(BASE_URL)

  // With fix: hard-cap fires at ~8s, tab reloads with ?reauth=1, lands on
  // /login (because the seeded session was cleared by the recovery path).
  // Without fix: tab hangs on Loading forever.
  const result = await waitForSettle(tab2, 15_000)
  const elapsed = Date.now() - start

  expect(result).not.toBe('timeout')

  // Recovery either lands on /login (reauth=1 → second hang escalation) or
  // settles fresh (lock was released between the reload and the new mount).
  // Either is a pass; hanging forever is the fail.
  expect(elapsed).toBeLessThan(15_000)
})

// ---------------------------------------------------------------------------
// Case C — React 19 StrictMode double-mount.
//   Expected with fix: hardCapStatusRef survives the remount; timer does not
//   double-fire; session settles correctly on the second mount's listener.
// ---------------------------------------------------------------------------

test('Case C: StrictMode double-mount does not double-fire hard cap', async ({ page }) => {
  // In dev mode, vite serves with React.StrictMode wrapping the tree (see
  // src/main.tsx). Production builds do NOT double-mount. This test must
  // run against the dev server.
  await page.goto(BASE_URL)

  const errorLogs: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('session restore hung')) {
      errorLogs.push(msg.text())
    }
  })

  const result = await waitForSettle(page, 10_000)
  expect(result).toBe('settled')

  // Hard-cap log should NEVER have fired on a clean restore, even with
  // double-mount. If it fired, the timer is racing the remount.
  expect(errorLogs).toHaveLength(0)
})
