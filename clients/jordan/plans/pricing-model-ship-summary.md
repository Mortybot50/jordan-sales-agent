# Pricing Model + Monthly Gate — Ship Summary

**Shipped:** 26/04/2026 (AEST)
**PR:** [#14](https://github.com/Mortybot50/jordan-sales-agent/pull/14) — squash-merged to `main` as `a9bc04d`
**Prod bundle:** `index-FfsK5snX.js` (probes verified on prod: `GATE HIT`, `Pipeline ACV`, `Held for Next Month`, `Mark install confirmed`)

## What it does

Replaces the legacy free-text "contract value" field with a real product catalogue (Purezza / Culligan / Zip HydroTap). Every deal is anchored to a sellable package, so ACV / TCV / commission compute deterministically. The dashboard now leads with a monthly $24.75k gate that locks last month's commission only when this month is hit, and forfeits it otherwise (driven by a daily pg_cron job at 00:30 AEST).

## Math

- **ACV** = `weekly_price × 52`
- **TCV** = `ACV × term_months / 12`
- **Commission** = `TCV × commission_pct / 100`  (default 7%)
- **Gate** ($24,750 ACV/mo): hit → prior month's commission moves `pending → unlocked`; miss → prior month's commission moves `pending → forfeited` (run on day 1 of next month).

Reconciled against spec — Cento Purezza 48mo @ $58.90/wk: ACV $3,062.80 · TCV $12,251.20 · Commission $857.58 ✓

## What landed

### Schema (`20260425000003_pricing_model_and_gate.sql`)

| Object | Purpose |
|---|---|
| `products` | 20 sellable packages across Purezza (5), Culligan (9), Zip HydroTap (6). Global RLS read-all to authenticated. |
| `deals.product_id`, `weekly_price_override`, `term_months`, `acv`, `tcv`, `commission_pct`, `commission_amount`, `close_won_at`, `install_scheduled_for`, `install_confirmed_at`, `install_completed_at`, `owner_user_id` | Deal-level financials + install lifecycle. All money columns are `numeric(10,2)`, ex-GST. |
| `monthly_gates` | Per (org, user, month) — target_acv, achieved_acv, hit_gate, locked_at, forfeited_at, prior_month_commission_amount/status. RLS via `auth_org_id()`. |
| `compute_deal_financials()` | BEFORE trigger on deals — re-computes acv/tcv/commission on insert + on `product_id`/`weekly_price_override`/`term_months`/`commission_pct` change. |
| `sync_close_won_at()` | BEFORE trigger — auto-stamps `close_won_at = now()` when stage moves to one matching `%won%` (and not `%lost%`). |
| `recompute_monthly_gate(p_org_id, p_user_id, p_month)` | Sums `deals.acv` whose `close_won_at` falls in the month at AEST; upserts the gate row; locks the gate + unlocks the prior month's commission when target is hit. |
| `trg_deals_recompute_gate_fn()` | AFTER trigger on deals — calls `recompute_monthly_gate` for the affected month(s). |
| `run_monthly_gate_forfeits()` + `pg_cron` job `monthly_gate_forfeits` | Daily 00:30 AEST — settles last month's gate (forfeits commission if not hit). |
| New stages | `Hold for Next Month` (5.5), `Pending Install` (6.3), `Installed` (6.6) seeded for every org. |

### UI

- **`/catalogue`** (new) — DataTable per brand: SKU · Label · Category · Weekly $ ex-GST · Default term · Default commission % · Water types · Active. Sidebar entry between Reopening Radar and Field Mode.
- **Add to pipeline dialog** (`PackageDealForm.tsx`) — replaces the freeform contract-value form. Brand → Package (filtered) → Term (12/24/36/48/60) → Weekly $ → Commission %. Live ACV/TCV/Commission readouts. Mint/amber "+X% vs catalogue" hint when weekly price is overridden. Stage / Title / Follow-up / Notes / Submit.
- **Pipeline DealCard** — ACV is now the headline value. Mint dot + tooltip when the deal contributes to this month's gate (`close_won_at` in current month, not held). "Held for {next month}" mint pill when `Hold for Next Month`. TCV / Commission subline.
- **DealDrawer** — new **Financial panel** (ACV / TCV / Commission / Term, plus "contributes to gate" pill when applicable). New **Install Lifecycle panel** with scheduled / confirmed / installed dates, "Mark install confirmed" + "Mark installed" CTAs, and an "earned" banner once installed. Hold-for-next-month CTAs (Hold / Move back / Move to Close Won).
- **Dashboard layout** —
  1. **`HeroGateCard`** (full-width) — dark, mint/amber/red tone based on % achieved + days remaining. Shows achieved $ / target $, %, GATE HIT or AT RISK pill, 20-segment MeterRail, pace-required line, prior-month pill (🔒 LOCKED / ❌ FORFEITED / pending).
  2. Existing `DarkAnchorBar` (Pipeline / Meetings / Reply rate / Jordan Score) preserved as second row.
  3. **`PipelineFinancialBar`** — Pipeline ACV (open) · Pipeline TCV (open) · Held for Next Month.
  4. **`PendingInstallsCard`** + **`EarnedThisYearCard`** in a 2-column row. Pending list shows oldest-first, status pill (Awaiting / Scheduled / Confirmed), clickable through to `/pipeline?deal=<id>`.

### Hard rules respected

- Money cols are `numeric(10,2)`, ex-GST.
- Multi-tenant RLS via `auth_org_id()` on every new table.
- No new design tokens — Phase F Dark Anchor only (`--jordan-accent-mint`, `--jordan-warm`, `--jordan-danger`, `--jordan-ink`, etc.).
- No demo password reset / no destructive seed reset.
- Deployed via `vercel --prod --yes`.

## Files

```
supabase/migrations/20260425000003_pricing_model_and_gate.sql

src/lib/queries/products.ts
src/lib/queries/monthlyGate.ts
src/lib/queries/deals.ts                          (expanded)
src/lib/schemas/deal.ts                           (added packageDealSchema)

src/pages/CataloguePage.tsx
src/pages/DashboardPage.tsx                       (new layout)
src/pages/ContactDetailPage.tsx                   (uses PackageDealForm)

src/components/pipeline/PackageDealForm.tsx
src/components/pipeline/DealCard.tsx              (ACV headline + held pill + gate dot)
src/components/pipeline/DealDrawer.tsx            (Financial + Install panels + hold CTAs)

src/components/dashboard/HeroGateCard.tsx
src/components/dashboard/PipelineFinancialBar.tsx
src/components/dashboard/PendingInstallsCard.tsx
src/components/dashboard/EarnedThisYearCard.tsx

src/components/layout/AppShell.tsx                (Catalogue sidebar entry)
src/App.tsx                                       (/catalogue route)
src/types/database.ts                             (regenerated)
```

## Smoke / known gaps

- Spec said "19 packages"; actually 20 ship (5 Purezza + 9 Culligan + 6 Zip). Kept all 20.
- `compute_deal_financials` only re-computes on the watched columns — manual `acv` overrides are **not** preserved, by design.
- Pre-existing lint errors in unrelated files (DraftPreviewPane, AppShell, ContactsPage, FieldPage, SettingsPage etc.) — not regressions, no CI gate.
- Bundle is 2.18 MB / 599 kB gzipped — code-splitting deferred (existing warning, unchanged from prior ships).
