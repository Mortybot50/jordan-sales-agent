import { defineConfig } from '@playwright/test'

/**
 * E2E smoke configuration.
 *
 * Local (default): starts the Vite dev server and runs against it.
 * Production smoke: SMOKE_BASE_URL=https://premiumwaterau.com.au npx playwright test
 *   (no webServer is started when SMOKE_BASE_URL is set).
 *
 * Auth: tests/e2e/global-setup.ts mints a session for the operator account via
 * the Supabase admin generate_link API (requires SUPABASE_SERVICE_ROLE_KEY +
 * SUPABASE_ANON_KEY in env, or a logged-in `supabase` CLI to fetch them).
 * Without credentials the authenticated specs are skipped, public ones run.
 */
const baseURL = process.env.SMOKE_BASE_URL ?? 'http://localhost:5173'

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL,
    storageState: 'tests/e2e/.auth-state.json',
    // Use the system Chrome: the downloaded Playwright Chromium lacks macOS
    // network permission on this machine (external HTTPS fails with
    // net::ERR_INVALID_HANDLE while localhost works).
    channel: 'chrome',
  },
  webServer: process.env.SMOKE_BASE_URL
    ? undefined
    : {
        command: 'npm run dev -- --port 5173 --strictPort',
        url: 'http://localhost:5173',
        reuseExistingServer: true,
        timeout: 60_000,
      },
})
