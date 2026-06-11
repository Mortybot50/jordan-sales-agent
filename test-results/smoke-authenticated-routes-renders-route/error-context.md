# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: smoke.spec.ts >> authenticated routes >> renders /route
- Location: tests/e2e/smoke.spec.ts:107:5

# Error details

```
Error: /route logged console errors:
Failed to load resource: the server responded with a status of 500 ()

expect(received).toEqual(expected) // deep equality

- Expected  - 1
+ Received  + 3

- Array []
+ Array [
+   "Failed to load resource: the server responded with a status of 500 ()",
+ ]
```

# Page snapshot

```yaml
- generic [ref=e2]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - generic [ref=e6]:
        - heading "LeadFlow" [level=1] [ref=e7]
        - paragraph [ref=e8]: Jordan's Sales Agent
      - generic [ref=e10]:
        - generic [ref=e12]: This week's target
        - generic [ref=e13]:
          - generic [ref=e14]: "0"
          - generic [ref=e15]: / 8–12 meetings
        - meter "Weekly qualified meetings progress" [ref=e16]
      - navigation [ref=e29]:
        - generic [ref=e30]:
          - generic [ref=e31]: CRM
          - generic [ref=e32]:
            - link "Dashboard" [ref=e33] [cursor=pointer]:
              - /url: /dashboard
              - img [ref=e34]
              - generic [ref=e39]: Dashboard
            - link "Pipeline" [ref=e40] [cursor=pointer]:
              - /url: /pipeline
              - img [ref=e41]
              - generic [ref=e43]: Pipeline
            - link "Contacts" [ref=e44] [cursor=pointer]:
              - /url: /contacts
              - img [ref=e45]
              - generic [ref=e50]: Contacts
            - link "Venue Groups" [ref=e51] [cursor=pointer]:
              - /url: /venue-groups
              - img [ref=e52]
              - generic [ref=e56]: Venue Groups
            - link "Catalogue" [ref=e57] [cursor=pointer]:
              - /url: /catalogue
              - img [ref=e58]
              - generic [ref=e62]: Catalogue
            - link "Field Mode" [ref=e63] [cursor=pointer]:
              - /url: /field
              - img [ref=e64]
              - generic [ref=e67]: Field Mode
            - link "Call Cycle" [ref=e68] [cursor=pointer]:
              - /url: /route
              - img [ref=e69]
              - generic [ref=e73]: Call Cycle
        - generic [ref=e74]:
          - generic [ref=e75]: Outbound
          - generic [ref=e76]:
            - link "Draft Queue 15 drafts awaiting review" [ref=e77] [cursor=pointer]:
              - /url: /drafts
              - img [ref=e78]
              - generic [ref=e81]: Draft Queue
              - generic "15 drafts awaiting review" [ref=e82]:
                - generic [ref=e83]: "15"
            - link "Sequences" [ref=e84] [cursor=pointer]:
              - /url: /sequences
              - img [ref=e85]
              - generic [ref=e89]: Sequences
            - link "Import CSV" [ref=e90] [cursor=pointer]:
              - /url: /import/contacts
              - img [ref=e91]
              - generic [ref=e94]: Import CSV
            - link "Sending Analytics" [ref=e95] [cursor=pointer]:
              - /url: /analytics/sending
              - img [ref=e96]
              - generic [ref=e98]: Sending Analytics
        - generic [ref=e99]:
          - generic [ref=e100]: Intelligence
          - generic [ref=e101]:
            - link "Sourcing" [ref=e102] [cursor=pointer]:
              - /url: /sourcing
              - img [ref=e103]
              - generic [ref=e106]: Sourcing
            - link "Reopening Radar" [ref=e107] [cursor=pointer]:
              - /url: /reopening-radar
              - img [ref=e108]
              - generic [ref=e115]: Reopening Radar
            - link "Briefing" [ref=e116] [cursor=pointer]:
              - /url: /briefing
              - img [ref=e117]
              - generic [ref=e123]: Briefing
        - generic [ref=e124]:
          - generic [ref=e125]: Settings
          - generic [ref=e126]:
            - link "Settings" [ref=e127] [cursor=pointer]:
              - /url: /settings
              - img [ref=e128]
              - generic [ref=e131]: Settings
            - link "Email inboxes" [ref=e132] [cursor=pointer]:
              - /url: /settings/email-accounts
              - img [ref=e133]
              - generic [ref=e136]: Email inboxes
            - link "Suppression list" [ref=e137] [cursor=pointer]:
              - /url: /settings/suppression-list
              - img [ref=e138]
              - generic [ref=e142]: Suppression list
        - generic [ref=e143]:
          - generic [ref=e144]: Admin
          - generic [ref=e145]:
            - link "Workers" [ref=e146] [cursor=pointer]:
              - /url: /admin/workers
              - img [ref=e147]
              - generic [ref=e149]: Workers
            - link "Postmaster Tools" [ref=e150] [cursor=pointer]:
              - /url: /settings/postmaster-tools
              - img [ref=e151]
              - generic [ref=e154]: Postmaster Tools
      - button "Sign out" [ref=e156]:
        - img
        - text: Sign out
    - main [ref=e158]:
      - generic [ref=e159]:
        - generic [ref=e162]:
          - generic [ref=e163]: Field cycle
          - heading "This week's call cycle" [level=1] [ref=e164]
          - paragraph [ref=e165]: Pick an anchor for each weekday — we'll suggest stops within your radius. Mark-visited writes to your field log and bumps the deal.
        - generic [ref=e166]:
          - tablist [ref=e168]:
            - tab "Mon" [ref=e169]
            - tab "Tue" [ref=e170]
            - tab "Wed" [ref=e171]
            - tab "Thu" [selected] [ref=e172]
            - tab "Fri" [ref=e173]
            - tab "Sat" [ref=e174]
          - tabpanel "Thu" [ref=e175]:
            - generic [ref=e176]:
              - generic [ref=e177]:
                - generic [ref=e179]: Anchor
                - generic [ref=e180]:
                  - generic [ref=e181]:
                    - generic [ref=e182]: Anchor venue
                    - combobox [ref=e183]:
                      - generic: — None —
                      - img
                  - generic [ref=e184]:
                    - generic [ref=e185]: or Suburb focus
                    - textbox "or Suburb focus" [ref=e186]:
                      - /placeholder: e.g. Thornbury
                  - generic [ref=e187]:
                    - generic [ref=e188]: Day note
                    - textbox "Day note" [ref=e189]:
                      - /placeholder: Reminders, cancellations, etc.
              - generic [ref=e190]:
                - generic [ref=e192]: Suggest knobs
                - generic [ref=e193]:
                  - generic [ref=e194]:
                    - generic [ref=e195]:
                      - generic [ref=e196]: Radius
                      - combobox [ref=e197]:
                        - generic: 5 km
                        - img
                    - generic [ref=e198]:
                      - generic [ref=e199]: Target stops
                      - combobox [ref=e200]:
                        - generic: 5 stops
                        - img
                  - generic [ref=e201]:
                    - generic [ref=e202]: Mix
                    - combobox [ref=e203]:
                      - generic: 70% prospect / 30% follow-up
                      - img
                  - generic [ref=e204]:
                    - button "Suggest 5 stops" [ref=e205]:
                      - img
                      - text: Suggest 5 stops
                    - button "Save" [ref=e206]
            - generic [ref=e208]:
              - generic [ref=e210]: Stops
              - generic [ref=e211]:
                - button "Open in Maps" [disabled]:
                  - img
                  - text: Open in Maps
                - button "Re-generate" [disabled]:
                  - img
                  - text: Re-generate
  - region "Notifications alt+T"
```

# Test source

```ts
  1   | /**
  2   |  * Route-walk smoke suite — every route must render real content with no
  3   |  * ErrorBoundary fallback and no console errors.
  4   |  *
  5   |  * Runs against the local dev server by default; against production with
  6   |  *   SMOKE_BASE_URL=https://premiumwaterau.com.au npx playwright test tests/e2e/smoke.spec.ts
  7   |  *
  8   |  * Authenticated routes need the session minted by global-setup (skipped
  9   |  * cleanly when credentials are unavailable).
  10  |  */
  11  | import { test, expect, type Page } from '@playwright/test'
  12  | import { readFileSync } from 'node:fs'
  13  | import path from 'node:path'
  14  | import { fileURLToPath } from 'node:url'
  15  | 
  16  | const __dirname = path.dirname(fileURLToPath(import.meta.url))
  17  | 
  18  | const AUTH_ROUTES = [
  19  |   '/dashboard',
  20  |   '/pipeline',
  21  |   '/reopening-radar',
  22  |   '/catalogue',
  23  |   '/field',
  24  |   '/route',
  25  |   '/contacts',
  26  |   '/contacts/new',
  27  |   '/contacts/import',
  28  |   '/import/contacts',
  29  |   '/drafts',
  30  |   '/sequences',
  31  |   '/sourcing',
  32  |   '/venue-groups',
  33  |   '/briefing',
  34  |   '/settings',
  35  |   '/settings/email-accounts',
  36  |   '/settings/seed-test',
  37  |   '/settings/postmaster-tools',
  38  |   '/settings/suppression-list',
  39  |   '/analytics/sending',
  40  |   '/admin/workers',
  41  | ]
  42  | 
  43  | const PUBLIC_ROUTES = ['/privacy', '/unsubscribe']
  44  | 
  45  | function hasAuthState(): boolean {
  46  |   try {
  47  |     const state = JSON.parse(
  48  |       readFileSync(path.join(__dirname, '.auth-state.json'), 'utf8'),
  49  |     ) as { origins?: unknown[] }
  50  |     return (state.origins?.length ?? 0) > 0
  51  |   } catch {
  52  |     return false
  53  |   }
  54  | }
  55  | 
  56  | // Errors we tolerate: noisy third-party/network blips that don't indicate a
  57  | // broken page. Everything else fails the route.
  58  | const IGNORED_CONSOLE = [
  59  |   /Failed to load resource.*(401|403|429)/, // auth races on parallel data fetches
  60  |   /net::ERR_/, // transient network
  61  |   /Download the React DevTools/,
  62  | ]
  63  | 
  64  | function collectConsoleErrors(page: Page): string[] {
  65  |   const errors: string[] = []
  66  |   page.on('console', (msg) => {
  67  |     if (msg.type() !== 'error') return
  68  |     const text = msg.text()
  69  |     if (IGNORED_CONSOLE.some((re) => re.test(text))) return
  70  |     errors.push(text)
  71  |   })
  72  |   page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  73  |   return errors
  74  | }
  75  | 
  76  | async function expectRouteRenders(page: Page, route: string, errors: string[]) {
  77  |   await page.goto(route, { waitUntil: 'domcontentloaded' })
  78  |   // Let queries settle + lazy chunks load.
  79  |   await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  80  | 
  81  |   const body = await page.locator('body').innerText()
  82  |   expect(body, `${route} hit the ErrorBoundary`).not.toContain('Something went wrong')
  83  |   expect(body.trim().length, `${route} rendered an empty page`).toBeGreaterThan(40)
> 84  |   expect(errors, `${route} logged console errors:\n${errors.join('\n')}`).toEqual([])
      |                                                                           ^ Error: /route logged console errors:
  85  | }
  86  | 
  87  | test.describe('public routes', () => {
  88  |   test.use({ storageState: { cookies: [], origins: [] } })
  89  |   for (const route of PUBLIC_ROUTES) {
  90  |     test(`renders ${route}`, async ({ page }) => {
  91  |       const errors = collectConsoleErrors(page)
  92  |       await expectRouteRenders(page, route, errors)
  93  |     })
  94  |   }
  95  | 
  96  |   test('unauthenticated app routes redirect to /login', async ({ page }) => {
  97  |     await page.goto('/dashboard')
  98  |     await page.waitForURL('**/login', { timeout: 15_000 })
  99  |     await expect(page.locator('body')).toContainText(/sign in|log in|email/i)
  100 |   })
  101 | })
  102 | 
  103 | test.describe('authenticated routes', () => {
  104 |   test.skip(!hasAuthState(), 'No Supabase credentials — session could not be minted')
  105 | 
  106 |   for (const route of AUTH_ROUTES) {
  107 |     test(`renders ${route}`, async ({ page }) => {
  108 |       const errors = collectConsoleErrors(page)
  109 |       await expectRouteRenders(page, route, errors)
  110 |       // Auth routes must not have bounced to /login.
  111 |       expect(page.url(), `${route} bounced to login`).not.toContain('/login')
  112 |     })
  113 |   }
  114 | 
  115 |   test('detail routes render against a real record', async ({ page }) => {
  116 |     const errors = collectConsoleErrors(page)
  117 |     // Pull the first contact + sequence straight off their list pages.
  118 |     await page.goto('/contacts')
  119 |     await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {})
  120 |     const firstRow = page.locator('table tbody tr').first()
  121 |     if ((await firstRow.count()) > 0) {
  122 |       await firstRow.click()
  123 |       await page.waitForURL('**/contacts/*', { timeout: 15_000 })
  124 |       await expectRouteRenders(page, page.url(), errors)
  125 |     }
  126 |   })
  127 | })
  128 | 
```