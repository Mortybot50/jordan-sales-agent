import { test, expect } from '@playwright/test'

/**
 * Two-step OTP login UI (12/06 rewrite).
 *
 * These tests run unauthenticated and use a deliberately non-existent email:
 * signInWithOtp({ shouldCreateUser: false }) returns "Signups not allowed"
 * for unknown addresses WITHOUT sending an email, which the UI maps to the
 * neutral "a code is on its way" message — so the suite never consumes the
 * email rate limit and never lands a real message in anyone's inbox.
 */

const PROBE_EMAIL = 'otp-ui-spec-nonexistent@example.com'

test.describe('OTP login flow', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('email step renders with code-first copy', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible()
    await expect(page.locator('#email')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible()
    // Password is the de-emphasised fallback, not the default.
    await expect(page.getByRole('button', { name: 'Sign in with password instead' })).toBeVisible()
    await expect(page.locator('#password')).toHaveCount(0)
  })

  test('submitting an email advances to the code step (neutral message)', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', PROBE_EMAIL)
    await page.getByRole('button', { name: 'Send code' }).click()

    await expect(page.getByRole('heading', { name: 'Enter your code' })).toBeVisible({
      timeout: 15_000,
    })
    // Neutral line — same for known and unknown addresses (no enumeration).
    await expect(page.getByRole('status')).toContainText('If that address has an account')
    await expect(page.locator('#otp-code')).toBeVisible()
    await expect(page.getByRole('button', { name: /Resend code in \d+s/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Use a different email' })).toBeVisible()
  })

  test('a wrong code shows the friendly error, not a raw API message', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', PROBE_EMAIL)
    await page.getByRole('button', { name: 'Send code' }).click()
    await expect(page.locator('#otp-code')).toBeVisible({ timeout: 15_000 })

    await page.fill('#otp-code', '000000')
    await page.getByRole('button', { name: 'Sign in' }).click()

    const error = page.locator('.text-destructive')
    await expect(error).toBeVisible({ timeout: 15_000 })
    await expect(error).toContainText('That code didn’t work')
    // Raw GoTrue message must not leak through.
    await expect(error).not.toContainText('Token has expired or is invalid')
  })

  test('code input only accepts digits and gates the submit button', async ({ page }) => {
    await page.goto('/login')
    await page.fill('#email', PROBE_EMAIL)
    await page.getByRole('button', { name: 'Send code' }).click()
    await expect(page.locator('#otp-code')).toBeVisible({ timeout: 15_000 })

    // 6 chars max — the input's maxLength clips before React's digit filter runs.
    await page.fill('#otp-code', 'a1b2c3')
    await expect(page.locator('#otp-code')).toHaveValue('123')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    await page.fill('#otp-code', '123456')
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  test('password fallback toggles on and back off', async ({ page }) => {
    await page.goto('/login')
    await page.getByRole('button', { name: 'Sign in with password instead' }).click()
    await expect(page.locator('#password')).toBeVisible()
    await page.getByRole('button', { name: 'Email me a code instead' }).click()
    await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible()
    await expect(page.locator('#password')).toHaveCount(0)
  })

  test('recovery banner still renders on ?reset=1', async ({ page }) => {
    await page.goto('/login?reset=1')
    await expect(page.getByText('Your session expired — please sign in again.')).toBeVisible()
    // Banner coexists with the OTP email step.
    await expect(page.getByRole('button', { name: 'Send code' })).toBeVisible()
  })
})
