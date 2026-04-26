# Quick Wins Batch 2 — Ship Summary

**Date:** 26/04/2026
**Branch:** `feat/quick-wins-batch-2`
**Scope:** Bundle four small, disjoint wins in a single PR.

---

## Win #1 — Per-deal next-step note + optional reminder date

**Status:** Shipped.

**Schema:**
```sql
ALTER TABLE deals ADD COLUMN next_step_note text;
ALTER TABLE deals ADD COLUMN next_step_due_at timestamptz;
CREATE INDEX idx_deals_next_step_due
  ON deals (org_id, next_step_due_at)
  WHERE next_step_due_at IS NOT NULL;
```
Migration name: `add_deal_next_step`. Applied via `mcp__supabase__apply_migration`.

**Files changed:**
- `src/types/database.ts` — added `next_step_note`/`next_step_due_at` to deals Row/Insert/Update.
- `src/lib/queries/deals.ts` — `Deal` interface gets the two columns; new `useUpdateDealNextStep(dealId)` hook with toast `"Next step saved"` / `"Next step cleared"`. Strips passthrough fields cleanly.
- `src/components/pipeline/DealDrawer.tsx` — new "Next step" section above the edit form. 280-char textarea with live count, quick-pick chips (Today / Tomorrow / Friday / Next Mon / +1 week / No date), date input, "Save next step" + "Clear" buttons. Saves into `next_step_due_at` at 09:00 local.
- `src/components/pipeline/DealCard.tsx` — italic note line under the title (truncated 50 chars), plus a contextual due-date pill: red ⏰ OVERDUE, mint 📌 TODAY / 📌 EEE for ≤3 days, muted 📌 d MMM otherwise.

**Evidence:**
- DB columns confirmed via `information_schema.columns` query: both rows returned.
- Build clean (`npm run build` passed; `tsc -b` clean).

**Smoke steps:**
1. Open any open deal in the drawer; type a 1-2 line note in "Next step"; pick a chip ("Friday"); Save.
2. Pipeline page → card now shows italic note + 📌 Fri pill.
3. Set a date in the past via picker → red ⏰ OVERDUE pill on card.
4. "Clear" wipes both fields.

---

## Win #2 — Deal aging indicator on Pipeline cards

**Status:** Shipped.

**Schema:** No change (purely view-derived).

**Files changed:**
- `src/lib/queries/deals.ts` — `useDeals` now folds `max(activities.occurred_at)` per deal_id and computes `days_since_last_activity = floor((now − max(updated_at, last_activity_at)) / 1d)`. Adds `last_activity_at` to the `Deal` interface for tooltip use. `useUpdateDeal` strips the new derived fields before write.
- `src/components/pipeline/DealCard.tsx` — aging tone computed: `severe` ≥ 30d, `warn` ≥ 14d, `whisper` 8-13d (subtle dot), none < 8d. Closed/won/lost/snoozed/held deals get no indicator. Hover tooltip on each pill: `Last touched: <date> (<N> days ago)`.
- `src/pages/PipelinePage.tsx` — new sort dropdown ("Sort: Default" / "Sort: Stalest first") in the page header; threads sort to KanbanBoard + DealListView. Default unchanged.
- `src/components/pipeline/KanbanBoard.tsx` — when `sortBy === 'stalest'`, sorts each column by `days_since_last_activity` desc.
- `src/components/pipeline/DealListView.tsx` — adds `'stalest'` SortField; reflects external sort changes from page-level dropdown.

**Evidence:** No DB-side changes. Compute is one extra query (deal_ids, occurred_at) merged into `useDeals` — same shape as the existing lead_scores fold.

**Smoke steps:**
1. Open Pipeline. A demo deal with no recent activity ≥ 14d shows amber "🕐 14d quiet"; ≥ 30d shows red "🚨 30d+ quiet".
2. Hover the pill — tooltip lists last-touch date and days-ago.
3. Toggle "Sort: Stalest first" — cards re-order with longest-quiet first per column.
4. Closed Won/Lost cards never show the aging pill.

---

## Win #3 — Activity timeline filter on contact detail

**Status:** Shipped.

**Schema:** No change.

**Files changed:**
- `src/pages/ContactDetailPage.tsx` — adds shadcn `<Tabs variant="line">` strip (All / Email / Call / Note / Meeting) above the timeline. Tab labels show counts e.g. `Email (12)`. Activity-type → bucket mapping covers all DB values (`call_note → call`, `note + voice_note → note`, `meeting_note + meeting_booked → meeting`, all email-family → email, stage_change/deal_created → only "All"). Per-bucket empty-state copy.

**Evidence:**
- DB activity types verified: `call_note, email_inbound, email_outbound, meeting_booked, note, stage_change, voice_note`.
- All present types are mapped.

**Smoke steps:**
1. Open a contact with mixed activity history.
2. Click "Email (n)" — only email events render. Click "Call" — only call notes. Etc.
3. Select a tab where the contact has zero entries → bucket-specific empty state.
4. "All" returns to the full timeline.

---

## Win #4 — Quick-add deal from contact detail

**Status:** Shipped.

**Schema:** No change.

**Files changed:**
- `src/pages/ContactDetailPage.tsx` — Deals section header button renamed `+ Add` → `+ New deal` to match spec phrasing. The existing dialog-open path already pre-fills via `submitPackageDeal`:
  - `contact_id` ← current contact
  - `venue_id` ← `contact.venue_id` (first linked venue)
  - `owner_user_id` ← logged-in user
  - `commission_pct` ← `user.default_commission_pct` (already wired in PR #18, falls back to 7%)
  - `stage_id` ← first stage from `useStages` (already in `PackageDealForm`)
- The page-header "Add to pipeline" button uses the same dialog. After save, navigates to `/pipeline?deal=<id>` so the new deal opens in DealDrawer immediately.

**Evidence:** No new code path required for prefill — verified all five fields are populated by the existing form. No bypass of the `packageDealSchema` (zod) validation.

**Smoke steps:**
1. Contact detail → "+ New deal" → dialog opens with brand defaulted, commission % at user's default, first stage selected.
2. Pick a package, hit Save → new deal opens directly in DealDrawer on Pipeline page.
3. Form errors still validated end-to-end (try empty title → schema error).

---

## Build / verification

| Check | Result |
|-------|--------|
| `tsc -b` | clean |
| `vite build` | clean (`✓ built in 421ms`) |
| Bundle probe (`Next step \| OVERDUE \| 14d quiet \| 30d\+ quiet \| Email \( \| New deal`) | 15 matches across 5 files |
| Migration applied | confirmed via `information_schema.columns` |
| `last_touch_at` trigger | not present (so we derive client-side from `updated_at` + max `activities.occurred_at`) |

## Constraints respected

- Dark Anchor design DNA: mint for positive (today / soon / line tab active); amber for warning (overdue, 14d quiet); red-soft for severe (30d+ quiet). No new colours.
- No edits to: suppression list, voice rules, learning loop, field mode, commission card, suburb autocomplete, snooze, lost-reason card, sequence engine, draft-queue work, ContactsPage / contact-list bulk actions.
- RLS preserved: all writes go through existing `deals` update path with `org_id` enforcement.
- No DB sequence engine added.
- Commit author: `mortybot50@gmail.com`.

## Closing status

| Win | Status | Files | Schema | Notes |
|-----|--------|-------|--------|-------|
| #1 Next-step note + reminder | Shipped | DealDrawer, DealCard, deals.ts, database.ts | +2 cols, +1 idx | Hook + chips + due-pill |
| #2 Deal aging indicator | Shipped | DealCard, deals.ts, PipelinePage, KanbanBoard, DealListView | none | 8/14/30d tiers + Stalest sort |
| #3 Activity timeline filter | Shipped | ContactDetailPage | none | Tabs with counts + per-bucket empties |
| #4 Quick-add deal | Shipped | ContactDetailPage | none | Renamed button; pre-fill already wired |
