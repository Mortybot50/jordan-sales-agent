# Jordan Sales Agent — Week 2 Self-Audit
**Date:** 2026-04-21
**Auditor:** DEV agent (read-only pass)
**Live URL:** https://jordan-sales-agent.vercel.app
**Supabase project:** bsevgxhnxlkzkcalevbb
**Screenshots:** `docs/audits/screenshots/`

---

## 1. Executive Summary

- The CRM core (contacts, pipeline, activities, briefing, settings) is functionally built and visually clean — Jordan could start entering real data today.
- **Two P1 bugs** need fixing before Jordan uses this: auth loading permanently hangs on direct URL access, and Reply Rate / Meeting Rate KPIs show dashes because of a seed data type mismatch.
- The app's entire value proposition — Draft Review Queue, AI drafting, email sequences — is a placeholder. Week 2 ended at the infrastructure layer. Week 3 is where Jordan gets ROI.
- 24 ESLint errors (React Compiler violations from components defined inside render functions) will cause real state bugs as the app grows under load.
- Mobile pipeline is broken — stuck on "Loading…" — and the Google Maps embed on contact detail never renders.

---

## 2. What Works Well

1. **Dashboard layout is sharp.** Pipeline Value ($32,800), Follow-ups Due, and Closes KPIs load with real numbers and make sense against the seeded data. Recent Activity feed shows 10 entries with correct timestamps and activity type icons.

2. **Pipeline Kanban is excellent for a Week 2 build.** All 7 stages render, deal cards show score badges (Hot/Warm/Cold), stage values and deal counts in column headers are accurate. The deal drawer opens cleanly, shows title/stage/value/follow-up/notes/activity, and has Delete/Save/Cancel.

3. **Contacts table is production-quality.** Search, tier filter (Hot/Warm/Cold), column sort, pagination structure, and contact detail page all work correctly via in-app navigation. The activity timeline on the detail page is the clearest part of the entire app.

4. **Briefing page structure is right.** 4 sections, accordion, Refresh button, real data in Overnight Replies (2 seeded inbound emails) and New Auto-sourced Candidates (5 seeded venues with Convert buttons). The section ordering matches the plan.

5. **Login flow is polished.** Error state on wrong password is clear ("Incorrect email or password. Please try again." in a pink banner). The LeadFlow branding on the login screen looks professional.

---

## 3. Broken or Weak (P0/P1 Bugs)

### Bug 1 — P1: Auth loading permanently hangs on direct URL access

**Severity:** P1
**Affected routes:** All routes when accessed via direct navigation (bookmark, refresh, new tab, `$B goto`)
**Screenshot:** `screenshots/briefing-page.png` (white screen, "Loading…" only, no sidebar)

**Reproduction:**
1. Log in via `/login`
2. Navigate away from the app (close tab)
3. Re-open any route directly, e.g. `https://jordan-sales-agent.vercel.app/briefing`
4. App shows "Loading…" and never resolves

**Root cause** (`src/hooks/useAuth.ts` line 49):
```typescript
supabase.auth.getSession().then(async ({ data: { session: s } }) => {
  setSession(s)
  if (s?.user) {
    const profile = await fetchUserProfile(s.user.id)
    setUser(profile)
  }
  setLoading(false)   // ← only called inside .then(), no finally/catch
})
```
If `getSession()` silently fails or the token refresh hangs (Supabase re-issues access tokens from refresh tokens — if that network call stalls, the `.then()` never fires), `setLoading(false)` is never called. The app freezes at the `RequireAuth` loading state forever.

**Confirmed in test:** After viewport changes in the headless browser (which force a page context reset), the auth loading consistently hung for 30+ seconds before timing out. The session token was present in `localStorage` but the loading state never cleared.

**Suggested fix:** Wrap with `finally`:
```typescript
supabase.auth.getSession().then(async ({ data: { session: s } }) => {
  setSession(s)
  if (s?.user) {
    const profile = await fetchUserProfile(s.user.id)
    setUser(profile)
  }
}).catch(console.error).finally(() => setLoading(false))
```

---

### Bug 2 — P1: Reply Rate and Meeting Rate always show `—`

**Severity:** P1
**Affected:** Dashboard KPI bar (first 2 cards)
**Screenshot:** `screenshots/dashboard-initial.png`

**Reproduction:** Open dashboard. Both "Reply Rate" and "Meeting Rate" show a long dash (`—`).

**Root cause** (`src/lib/queries/dashboard.ts` lines 31–38):
The KPI query counts activities with `activity_type = 'email_sent'` as the denominator. But the seed data and the `activityTypeLabel()` utility use `'email_outbound'` for manually logged outbound emails. There are 0 `email_sent` activities in the database (SQL confirmed: `emailsSent = 0`), so the rate calculation returns `null` and the UI renders `—`.

**Evidence from SQL:**
```
SELECT count(*) FROM activities WHERE activity_type = 'email_sent';  → 0
SELECT count(*) FROM activities WHERE activity_type = 'email_outbound'; → 2
```

The KPI is only meaningful once real email sending is wired up (Week 3+), but the seed data should use `email_sent` for seeded outbound emails to demonstrate the KPI working.

**Suggested fix (two options):**
- Option A: Change seed data to use `email_sent` instead of `email_outbound` for the 2 outbound email activities.
- Option B: Include `email_outbound` in the KPI denominator query alongside `email_sent`.

---

### Bug 3 — P1: Mobile pipeline stuck on "Loading…"

**Severity:** P1
**Affected:** `/pipeline` at 375px viewport
**Screenshot:** `screenshots/pipeline-mobile.png` (white screen, "Loading…" centre)

**Reproduction:** Load `/pipeline` on mobile width. The page never renders.

Same root cause as Bug 1: mobile viewport triggers a full page reload, which re-initialises `useAuth`, which gets stuck. The Pipeline page at mobile width uses `PipelinePage` which renders `DealListView` — both components are affected by the auth loading bug.

**Distinct from Bug 1** in that this is easily triggered by any real user on a phone, not just a headless browser edge case.

---

### Bug 4 — P2: Google Maps embed never renders

**Severity:** P2
**Affected:** Contact detail page, venue card
**Screenshot:** `screenshots/contact-detail.png` (grey box with a "Maps ↗" button, no map)

**Root cause** (`src/pages/ContactDetailPage.tsx` line 425):
```typescript
src={`https://www.google.com/maps?q=${encodedAddress}&output=embed`}
```
This URL scheme (`?q=...&output=embed`) has been deprecated by Google. Modern browsers block it via `X-Frame-Options`. The iframe renders as a grey box. The browser network tab shows the request completes with 200, but the content is a redirect to the Maps website with frame embedding refused.

**Suggested fix:** Replace with the static Maps Embed API:
```
https://www.google.com/maps/embed/v1/place?key=MAPS_API_KEY&q=ADDRESS
```
This requires a `VITE_GOOGLE_MAPS_API_KEY` env var and the Maps Embed API enabled in GCP. Alternatively, use a link-only approach (remove the iframe, just show an "Open in Maps" link) until the API key is set up.

---

### Bug 5 — P2: Pipeline stages drag reorder is a fake affordance

**Severity:** P2
**Affected:** Settings → Pipeline Stages tab
**Screenshot:** `screenshots/settings-stages.png`

Drag handles (⠿ grip icon) are visible on every stage row. Clicking/dragging does nothing. The page itself says: *"Drag handles are visual — full reorder coming in a future update."*

Showing drag handles that do nothing is worse than not showing them. Jordan will try to drag, fail, and assume the app is broken.

**Suggested fix:** Remove the drag handle icons from the stage rows until the feature is implemented. A plain list of stages with reorder not yet available is honest.

---

### Bug 6 — P2: Briefing overnight replies have no action buttons

**Severity:** P2
**Affected:** `/briefing` — Section 1 (Overnight Replies)
**Screenshot:** `screenshots/briefing-via-nav.png`

The plan spec says Overnight Replies should have: "AI-drafted response ready. One-click approve." What's built: the 2 seeded inbound emails show (contact name, timestamp) but there are no action buttons. The user can see a reply came in but can't do anything about it from the briefing.

The reply body is also not visible without clicking to expand.

**Suggested fix:** Minimum viable: expand the accordion item to show the reply subject and body. The "Draft response" and "Approve" buttons are Week 3 (AI layer), but a "View in pipeline" link to the contact detail would be useful now.

---

### Bug 7 — P2: ErrorBoundary leaks full stack traces in production

**Severity:** P2
**Affected:** `src/main.tsx` lines 30–50

The `ErrorBoundary` renders the full error message and stack trace in the browser regardless of `NODE_ENV`. Verified in code:
```typescript
<pre style={{ color: '#fbbf24', fontSize: '11px', overflow: 'auto' }}>
  {this.state.error?.stack}
</pre>
```
No `process.env.NODE_ENV === 'production'` gate.

**Suggested fix:** In production, show "Something went wrong. Please reload." In dev, show the full stack trace.

---

## 4. Shallow / Feels Like a Stub

| Feature | What Exists | What's Missing |
|---------|-------------|----------------|
| **Morning Briefing — Section 1** | Shows 2 inbound email entries with contact names and timestamps | No reply body visible, no action buttons, no "Draft response" affordance |
| **Morning Briefing — Follow-ups Due** | Section renders with count badge | 0 tasks in today's window in seed data (all due dates are past or tomorrow AEST). Query also doesn't surface overdue tasks, only today's |
| **Settings — Pipeline Stages** | Shows all 7 stages, colour dots, delete button | Drag reorder is fake (see Bug 5), no inline rename (clicking stage name does nothing) |
| **Settings — Profile** | Form renders with Calendly URL and signature fields | Seed data has no user profile data — Full Name field is blank on load |
| **Settings — Integrations** | Shows 5 integration cards (Gmail, Instantly.ai, SendGrid, Anthropic, Proxycurl) | All "Not connected" with no connect button, no OAuth flow, no way to actually connect anything |
| **Contact detail — Venue hospitality fields** | Shows: cover count, address, website | Missing: kitchen type, competitor water usage, licensing status, seasonality window — all are in the DB schema, none are displayed in the UI |
| **Dashboard — Warm Leads** | Section renders with correct description copy | Always empty in demo: seeded warm-scored deals all have `last_touch_at` within 7 days. The section is invisible to Morty in demo mode |

---

## 5. Missing Entirely

Ranked by impact on Jordan's daily use:

| # | Feature | Plan Reference | Impact |
|---|---------|----------------|--------|
| 1 | **Draft Review Queue (AI drafting)** | Section 5, Week 3 | The entire value prop. Without AI drafts, the app is a manual CRM. |
| 2 | **3-stage email sequence engine** | Plan sections 5, 9 (Week 5) | Jordan can't send anything. Sequence builder and enrollment are 0-built. |
| 3 | **Gmail OAuth + inbound reply watch** | Plan sections 4, 9 (Week 4) | Overnight replies section pulls from fake seed data. Real Gmail = 0% wired. |
| 4 | **Morning briefing 7am email digest** | Plan section 5 | In-app briefing exists but the email Jordan wakes up to doesn't. |
| 5 | **Calendly embed + webhook** | Plan sections 5, 9 (Week 8) | Meeting Booked stage auto-move = 0. Calendly URL field exists in Settings but is never used. |
| 6 | **CSV export / data backup** | Plan section 2 (IN v1) | Export button = nowhere. Morty asked for this explicitly. |
| 7 | **Pipeline stages: Replied, Site Visit, Demo Completed** | Plan section 3 | Plan specifies 9 stages. Only 7 seeded. 3 Purezza-specific stages are missing. |
| 8 | **Duplicate detection on CSV import** | Plan section 2 | Import works but no dedup checking. |
| 9 | **Contact notes field** | ContactDetailPage line 362 | Notes show in read-only if they exist but the contact new/edit form has no notes field. |
| 10 | **Sequence builder UI** | Plan section 5 | Not started. 0 sequences, 0 steps in DB. |
| 11 | **Auto-sourcing worker (Google Places)** | Plan section 6 | The 5 candidates in Briefing section 3 are seeded manually. No worker runs. |
| 12 | **VCGLR / LinkedIn signal workers** | Plan section 7 | Tables exist in schema, 0 signals, 0 worker_runs. |

---

## 6. Recommended Week 3 Scope

| Priority | Feature | Effort | Why |
|----------|---------|--------|-----|
| **P0** | Fix useAuth loading bug (Bug 1 + 3) | **S** | Blocks Jordan from using any route on reload |
| **P0** | Fix Reply Rate / Meeting Rate (Bug 2) | **S** | Embarrassing on demo — two of 5 KPIs are broken |
| **P1** | Claude API draft generation + Draft Review Queue UI | **XL** | The entire value proposition |
| **P1** | Gmail OAuth + Pub/Sub webhook (inbound replies) | **L** | The "overnight replies" section is seeded fakes without it |
| **P2** | Instantly.ai integration for outbound sequencing | **L** | Can't send cold emails without this |
| **P2** | Add missing 3 pipeline stages (Replied, Site Visit, Demo Completed) | **S** | Stage mismatch with Purezza's actual sales process |
| **P2** | Fix Google Maps embed (Bug 4) | **S** | Venue map is a grey box on every contact page |
| **P3** | Briefing overnight replies — add body text + "View deal" link | **S** | Currently shows names but no actionable content |
| **P3** | Remove fake drag handles from Settings stages (Bug 5) | **S** | Confusing affordance |
| **P3** | Add venue hospitality fields to ContactDetailPage | **M** | `kitchen_type`, `competitor_water_usage`, `licensing_status` are in the DB, not in the UI |

---

## 7. Recommended Week 3 Polish

Small fixes with disproportionate feel improvement:

| Fix | Effort | Evidence |
|-----|--------|---------|
| Seed the profile (Full Name, signature) so Settings/Profile tab doesn't load blank | **S** | `screenshots/settings-page.png` — empty Full Name on load |
| Fix seed data: set `last_touch_at` to >7 days ago for warm-scored deals so Warm Leads section shows data | **S** | Dashboard warm leads = perpetually empty in demo |
| Add overdue tasks to Follow-ups Due query (not just today's) | **S** | 2 past-due tasks exist in DB, KPI shows 0 |
| Add "Notes" field to ContactNewPage and ContactDetailPage edit form | **S** | Field exists in DB + detail view, missing from create/edit form |
| ErrorBoundary: gate stack trace behind NODE_ENV (Bug 7) | **S** | Full stack visible in prod |
| `aria-describedby` warning on all DialogContent components | **S** | Console warning on every modal open |
| Show reply body in Briefing Section 1 (accordioned, collapsed by default) | **S** | Currently just name + timestamp |
| Dashboard "Start draft" button on warm leads — wire to `/drafts` or disable with tooltip until Week 3 | **S** | Plan mentions this CTA; currently absent |

---

## 8. Technical Debt

### Bundle size
931kB uncompressed / 269kB gzipped for a single JS chunk. The warning is real:
```
(!) Some chunks are larger than 500 kB after minification.
```
The entire app ships as one chunk with no code splitting. As Week 3 adds Claude API client libraries and Recharts, this will grow. **Recommended:** Add `build.rolldownOptions.output.codeSplitting` or dynamic `import()` for the heaviest pages (ContactDetailPage, KanbanBoard, ContactImportPage).

### ESLint errors
`npm run lint` returns **24 errors, 6 warnings**. All 22 errors are `react-hooks/static-components` — components defined inside render functions. This is a real React Compiler bug: the components reset state on every parent re-render.

Affected files:
- `AppShell.tsx:60` — `SidebarContent` defined inside `AppShell`
- `DealListView.tsx:120` — `SortIcon` defined inside `DealListView`
- `ContactsPage.tsx:89` — `SortIcon` defined inside `ContactsPage`

These won't crash today but will cause subtle state bugs (dropdowns resetting, inputs losing focus) as the UI becomes more complex. Fix: move these to module-level function declarations.

### TypeScript strict mode off
`tsconfig.app.json` lacks `"strict": true`. This means no `strictNullChecks`, no `strictFunctionTypes`, no `noImplicitAny`. The codebase uses `noUnusedLocals` and `noUnusedParameters` but not the safety-critical strict options. Confirmed: 0 explicit `any` usages found (good), but null-safety is not enforced by the compiler.

### RLS N+1 query pattern
`auth_org_id()` function (confirmed via SQL):
```sql
select coalesce(
  (auth.jwt() ->> 'org_id')::uuid,
  (select org_id from public.users where id = auth.uid())
);
```
The JWT path always fails (Supabase standard JWTs don't include `org_id`), so every RLS check executes a secondary `SELECT` against `public.users`. With 7 parallel queries on the dashboard, that's 7 extra `users` table reads per page load. At Jordan's scale this is fine, but it will show up in Supabase's slow query logs at any reasonable concurrent usage. Fix: configure a Supabase JWT hook to inject `org_id` into the JWT claims.

### No indexes on warm leads query path
The warm leads query joins `deals` → `lead_scores` by `deal_id` with a `score` range filter. There is no index on `lead_scores(deal_id, score)`. Migration 003 adds some indexes but not this one. Fine at 12 deals, slow at 5,000.

### React Query duplicate user fetches
`useAuth` is called in both `RequireAuth` (App.tsx) and `AppShell.tsx` and individual page components (BriefingPage, ContactDetailPage, SettingsPage). Each call is independent state — there's no shared context or React Query caching. This means multiple `supabase.auth.getSession()` calls per page load. Fix: lift `useAuth` to a context provider and consume it from there.

---

## 9. Module-by-Module Scorecard

| Module | Spec Compliance (0–10) | UX Quality (0–10) | Polish (0–10) | Verdict |
|--------|----------------------|-------------------|--------------|---------|
| **Login** | 9 | 9 | 9 | Solid. Error state works, redirect works, session persists in SPA navigation. Direct URL reload is the auth bug. |
| **Dashboard** | 6 | 7 | 7 | 3 of 5 KPIs work. Warm Leads always empty in demo. Pipeline Health is great. Reply/Meeting Rate are broken. |
| **Pipeline — Kanban** | 8 | 8 | 8 | All 7 stages, correct counts, deal cards look good. Drag-drop works in-browser. Desktop-only is appropriate. |
| **Pipeline — Mobile** | 2 | 1 | 1 | Permanently stuck on "Loading…" at 375px. Unusable. |
| **Contacts — List** | 8 | 8 | 8 | Search, filter, sort, pagination structure all work. Clean table layout. |
| **Contacts — Detail** | 6 | 7 | 6 | Activity timeline excellent. Google Maps = grey box. Venue hospitality fields absent. Notes field missing from edit form. |
| **Contact New** | 8 | 8 | 7 | Zod validation fires correctly. Venue search works. Inline create works. No notes field. |
| **Contact Import** | 7 | 7 | 7 | CSV upload + column mapping UI exists. No dedup. Cannot verify end-to-end without a test CSV (import route hits auth bug on direct URL). |
| **Morning Briefing** | 5 | 5 | 6 | 4 sections present. Overnight replies show data but no actions. Follow-ups Due = 0 due to seed timing. Candidates section with Convert works. |
| **Draft Review Queue** | 1 | 4 | 6 | 100% placeholder. Good "What's coming" copy. The icon and layout are nice. But zero function. |
| **Settings — Profile** | 7 | 7 | 6 | Fields correct, save works. Loads blank because demo user has no profile data seeded. |
| **Settings — Stages** | 5 | 5 | 5 | Shows stages correctly. Fake drag handles. No inline rename. Delete button exists but untested with deals present. |
| **Settings — ICP** | 7 | 7 | 6 | Multi-select venue types render, save works. |
| **Settings — Integrations** | 3 | 5 | 6 | All "Not connected" with no connect action. Informational only. Correctly deferred to Week 3. |

---

## Appendix: Evidence Index

| Claim | Evidence |
|-------|---------|
| Auth loading hangs | `screenshots/briefing-page.png`, `screenshots/contacts-list.png`, `src/hooks/useAuth.ts:49` |
| Reply/Meeting Rate show `—` | `screenshots/dashboard-initial.png`, SQL: 0 `email_sent` activities |
| Mobile pipeline broken | `screenshots/pipeline-mobile.png` |
| Google Maps grey box | `screenshots/contact-detail.png`, `ContactDetailPage.tsx:425` |
| Fake drag handles | `screenshots/settings-stages.png`, UI copy "full reorder coming in a future update" |
| 0 email drafts | SQL: `SELECT count(*) FROM email_drafts → 0` |
| 0 sequences | SQL: `SELECT count(*) FROM sequences → 0` |
| 24 lint errors | `npm run lint` output |
| N+1 auth_org_id | SQL: `pg_get_functiondef('auth_org_id')` |
| Warm leads always empty | SQL: all warm-scored deals have `last_touch_at` within 7 days |
| Briefing no action buttons | `screenshots/briefing-via-nav.png` — accordion shows names only |
| ErrorBoundary leaks stack | `src/main.tsx:43-50` — no NODE_ENV gate |
| Stage count mismatch | Settings screenshot: 7 stages; plan spec: 9 stages |
