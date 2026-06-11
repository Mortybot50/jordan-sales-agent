/**
 * Route-walk smoke suite — every route must render real content with no
 * ErrorBoundary fallback and no console errors.
 *
 * Runs against the local dev server by default; against production with
 *   SMOKE_BASE_URL=https://premiumwaterau.com.au npx playwright test tests/e2e/smoke.spec.ts
 *
 * Authenticated routes need the session minted by global-setup (skipped
 * cleanly when credentials are unavailable).
 */
import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const AUTH_ROUTES = [
  '/dashboard',
  '/pipeline',
  '/reopening-radar',
  '/catalogue',
  '/field',
  '/route',
  '/contacts',
  '/contacts/new',
  '/contacts/import',
  '/import/contacts',
  '/drafts',
  '/sequences',
  '/sourcing',
  '/venue-groups',
  '/briefing',
  '/settings',
  '/settings/email-accounts',
  '/settings/seed-test',
  '/settings/postmaster-tools',
  '/settings/suppression-list',
  '/analytics/sending',
  '/admin/workers',
]

const PUBLIC_ROUTES = ['/privacy', '/unsubscribe']

function hasAuthState(): boolean {
  try {
    const state = JSON.parse(
      readFileSync(path.join(__dirname, '.auth-state.json'), 'utf8'),
    ) as { origins?: unknown[] }
    return (state.origins?.length ?? 0) > 0
  } catch {
    return false
  }
}

// Errors we tolerate: noisy third-party/network blips that don't indicate a
// broken page. Everything else fails the route.
const IGNORED_CONSOLE = [
  /Failed to load resource.*(401|403|429)/, // auth races on parallel data fetches
  /net::ERR_/, // transient network
  /Download the React DevTools/,
]

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return
    errors.push(text)
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

async function expectRouteRenders(page: Page, route: string, errors: string[]) {
  await page.goto(route, { waitUntil: 'domcontentloaded' })
  // Let queries settle + lazy chunks load.
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})

  const body = await page.locator('body').innerText()
  expect(body, `${route} hit the ErrorBoundary`).not.toContain('Something went wrong')
  expect(body.trim().length, `${route} rendered an empty page`).toBeGreaterThan(40)
  expect(errors, `${route} logged console errors:\n${errors.join('\n')}`).toEqual([])
}

test.describe('public routes', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  for (const route of PUBLIC_ROUTES) {
    test(`renders ${route}`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      await expectRouteRenders(page, route, errors)
    })
  }

  test('unauthenticated app routes redirect to /login', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL('**/login', { timeout: 15_000 })
    await expect(page.locator('body')).toContainText(/sign in|log in|email/i)
  })
})

test.describe('authenticated routes', () => {
  test.skip(!hasAuthState(), 'No Supabase credentials — session could not be minted')

  for (const route of AUTH_ROUTES) {
    test(`renders ${route}`, async ({ page }) => {
      const errors = collectConsoleErrors(page)
      await expectRouteRenders(page, route, errors)
      // Auth routes must not have bounced to /login.
      expect(page.url(), `${route} bounced to login`).not.toContain('/login')
    })
  }

  test('detail routes render against a real record', async ({ page }) => {
    const errors = collectConsoleErrors(page)
    // Pull the first contact + sequence straight off their list pages.
    await page.goto('/contacts')
    await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
    const firstRow = page.locator('table tbody tr').first()
    if ((await firstRow.count()) > 0) {
      await firstRow.click()
      await page.waitForURL('**/contacts/*', { timeout: 15_000 })
      await expectRouteRenders(page, page.url(), errors)
    }
  })
})
