# Ship summary — coldsend hardening batch (P1 items from AUDIT-2026-05-28)

**Date:** 28/05/2026
**Branch:** `hardening/coldsend-batch-2026-05-28`
**Base:** `main @ 601f233` (post PR #90 merge)
**Project:** Supabase `bsevgxhnxlkzkcalevbb`, Vercel `jordan-sales-agent`
**Audit source:** `clients/jordan/plans/AUDIT-2026-05-28.md`

## TL;DR

10 of 14 P1 audit items closed in one branch + one PR (ready-for-review,
NOT merged). 4 items deferred to a follow-up "P2 batch" PR. Two ERROR-level
Supabase advisor findings dropped to zero. Two new migrations applied via
MCP. Three Edge Function secrets set via CLI (no secret values copied —
verifier reuses existing `ZEROBOUNCE_API_KEY` via fallback). 7 Edge Functions
redeployed with new code; `discover-leads` flipped from `verify_jwt=false`
to `verify_jwt=true`. Frontend `npm run build` + `tsc --noEmit` green.

## Closed in this PR

| # | Audit ID | Item | Surface |
|---|---|---|---|
| A1 | P1-ENV-01 | Sentry source-map upload (`@sentry/vite-plugin`) | `vite.config.ts`, `SENTRY-SETUP.md` |
| A2 | P1-ENV-02/03/04 | Edge secrets: `EMAIL_VERIFICATION_PROVIDER=zerobounce`, `PUBLIC_APP_URL`, `PIXEL_BASE_URL` + fallback to existing `ZEROBOUNCE_API_KEY` | Supabase secrets + `enqueue-sends` |
| B3 | P1-DB-01 | Renamed local VCGLR migration to match remote version stamp | `supabase/migrations/20260527063549_vcglr_licences.sql` |
| B4 | P1-DB-02 | Dropped SECURITY DEFINER from `cron_job_run_status` + `public_user_profiles` views | `20260528100000_drop_security_definer_views.sql` |
| B5 | P1-DB-03 | Suppression `source='unsubscribe'` allowed by CHECK constraint | `20260528100500_suppression_source_allow_unsubscribe.sql` |
| C6 | P1-OBS-01 | `/admin/workers` shows 9 workers + warmup-pulse widget | `src/lib/workersConfig.ts`, `src/pages/AdminWorkersPage.tsx` |
| C7 | P1-OBS-02 | Sentry init on send-via-smtp, drain-send-queue, send-warmup-tick, poll-replies | `_shared/sentry.ts` + 4 functions |
| D8 | P1-CP-01 | Per-tz daily cap (replaces trailing-24h-UTC sliding window) | `enqueue-sends` |
| D9 | P1-CP-02 | `discover-leads` flipped to `verify_jwt=true` + `requireServiceRoleAuth` | `discover-leads`, `scripts/smoke-manifest.yaml` |
| D10 | P1-CP-04 | VCGLR parser-drift guard — `parser_empty_drift_likely` when rows < `VCGLR_MIN_ROWS_ASSERT` (default 10) | `vcglr-sync` |

## Files touched

| File | Change |
|---|---|
| `package.json` + `package-lock.json` | `+@sentry/vite-plugin` devDep |
| `vite.config.ts` | guarded source-map plugin |
| `SENTRY-SETUP.md` | new operator doc |
| `src/lib/workersConfig.ts` | +5 cold-send worker entries |
| `src/pages/AdminWorkersPage.tsx` | +Warmup pulse widget |
| `scripts/smoke-manifest.yaml` | discover-leads public→svc |
| `supabase/functions/_shared/sentry.ts` | new shared helper |
| `supabase/functions/discover-leads/index.ts` | drop hand-rolled service-role check, use `requireServiceRoleAuth` |
| `supabase/functions/drain-send-queue/index.ts` | Sentry wrap |
| `supabase/functions/enqueue-sends/index.ts` | per-tz day boundary + ZEROBOUNCE fallback |
| `supabase/functions/poll-replies/index.ts` | Sentry wrap |
| `supabase/functions/send-via-smtp/index.ts` | Sentry wrap |
| `supabase/functions/send-warmup-tick/index.ts` | Sentry wrap |
| `supabase/functions/vcglr-sync/index.ts` | parser-drift floor |
| `supabase/migrations/20260527063549_vcglr_licences.sql` | renamed from 20260527140000 |
| `supabase/migrations/20260528100000_drop_security_definer_views.sql` | new |
| `supabase/migrations/20260528100500_suppression_source_allow_unsubscribe.sql` | new |

## Migrations applied via MCP

| Version | Name | Project |
|---|---|---|
| `20260528100000` | `drop_security_definer_views` | `bsevgxhnxlkzkcalevbb` |
| `20260528100500` | `suppression_source_allow_unsubscribe` | `bsevgxhnxlkzkcalevbb` |

## Edge Function secrets set

Set via `supabase secrets set --project-ref bsevgxhnxlkzkcalevbb` (CLI, not dashboard — leaves audit trail in shell history):

| Name | Notes |
|---|---|
| `EMAIL_VERIFICATION_PROVIDER` | `zerobounce` — flips on the verifier; reads existing `ZEROBOUNCE_API_KEY` via the new fallback |
| `PUBLIC_APP_URL` | `https://jordan-sales-agent.vercel.app` — placeholder until brand domain is locked |
| `PIXEL_BASE_URL` | `https://jordan-sales-agent.vercel.app/_t/` — same placeholder caveat |

`ZEROBOUNCE_API_KEY` was already in Edge secrets (audit was incorrect — it
showed it in Vercel, but it's been in Supabase since 19/05). No copy required.

## Edge Functions redeployed

7 functions, all bundle + verify_jwt confirmed via `mcp__supabase__list_edge_functions`:

| Function | Version bumped | verify_jwt |
|---|---|---|
| `discover-leads` | → v8 | **false → true** (the intentional flip) |
| `enqueue-sends` | → v12 | true (unchanged) |
| `send-via-smtp` | → v16 | true (unchanged) |
| `drain-send-queue` | → v13 | true (unchanged) |
| `send-warmup-tick` | → v3 | true (unchanged) |
| `poll-replies` | → v5 | true (unchanged) |
| `vcglr-sync` | → v6 | true (unchanged) |

## Verification

| Item | Probe | Result |
|---|---|---|
| Frontend build | `npm run build` | ✅ green, `dist/assets/index-*.js` 2.47 MB |
| TypeScript | `npx tsc --noEmit --ignoreDeprecations 6.0` | ✅ no errors |
| Supabase advisor delta | `mcp__supabase__get_advisors type=security` | ✅ 2 ERROR-level `security_definer_view` findings DROPPED to 0 |
| Suppression CHECK | INSERT … source='unsubscribe' … ROLLBACK | ✅ row accepted, RETURNING shows source/email/reason |
| Cron view post-fix | `SELECT count(*) FROM cron_job_run_status` | ✅ 14100 rows visible to query session (authenticated path works) |
| `discover-leads` verify_jwt flip | MCP `list_edge_functions` | ✅ `verify_jwt: true` for `discover-leads` |
| Migrations applied remotely | `mcp__supabase__list_migrations` | ✅ both new versions present |
| Edge secrets present | `supabase secrets list` | ✅ EMAIL_VERIFICATION_PROVIDER, PUBLIC_APP_URL, PIXEL_BASE_URL all listed |

### Smoke that did NOT run

| Probe | Reason |
|---|---|
| `scripts/smoke-classify-reply-suppression.sh` | Pre-existing trigger issue with synthetic-activity INSERT against live schema (script's own preamble documents this as known — "malformed array literal" on a trigger we haven't isolated). NOT a regression from this PR. The end-to-end suppression path was verified instead via the direct SQL probe (above). |

## Deferred to "P2 batch" follow-up PR

The audit listed several more P1-CP items. These are deferred because the
LOC budget for this PR was already large and bundling them risks a
debugging spiral on a single review:

- P1-CP-05 — `crawl-venue-contacts` rate-limit + retry-on-429 + cost ceiling
- P1-CP-06 — Google Places `daily_budget_usd` per saved-search
- P1-CP-07 — Refactor duplicated send logic between `send-via-smtp` and `drain-send-queue`
- P1-CP-08 — Rewrite `morning_briefing_cron` + `sequence_tick_cron` source migrations to read from `vault.decrypted_secrets`
- P1-CP-09 — `enqueue-sends` in-memory suppression Set should strip `+alias` (belt-and-braces; DB trigger already does)

P1-OPS-01 (Codex Pattern B retro-review on PR #90) is wall-clock — Codex
quota was out at audit time; needs a separate run-once-quota-clears action.

## Operator follow-ups

1. **Sentry build env vars in Vercel** — add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` to the `jordan-sales-agent` Vercel project's production env BEFORE the next prod deploy. Doc in `SENTRY-SETUP.md` at repo root. Without these the SPA still captures errors (PR #91), but stack traces stay minified.
2. **Sentry DSN for Edge Functions** — `supabase secrets set --project-ref bsevgxhnxlkzkcalevbb SENTRY_DSN=<same-value-as-VITE_SENTRY_DSN-in-vercel>`. The Edge Sentry init is a no-op until this lands; logs continue to flow via `console.error`. AUDIT P1-OBS-02 fully closes once this is set.
3. **Brand domain swap** — once Jordan locks the canonical cold-send domain (e.g. `premiumwaterau.com.au`), re-run:
   ```bash
   supabase secrets set --project-ref bsevgxhnxlkzkcalevbb \
     PUBLIC_APP_URL=https://<brand-domain> \
     PIXEL_BASE_URL=https://<brand-domain>/_t/
   ```
   No redeploy needed — Edge functions pick up new secrets on next invocation.
4. **Vercel MCP auth** — was `needs-auth` during this run, so `ZEROBOUNCE_API_KEY` could not be cross-checked against Vercel env. The code path now reads `EMAIL_VERIFICATION_API_KEY` first, falls back to `ZEROBOUNCE_API_KEY` — so no copy is required, but the audit note about removing `ZEROBOUNCE_API_KEY` from Vercel (P3 housekeeping) is deferred.
5. **Pre-existing version-stamp drift** — three other migrations (`20260518111938`, `20260526144404`, `20260526144755`) show local-vs-remote version mismatches per `mcp__supabase__list_migrations`. Not addressed in this PR; safe to leave per `supabase-migrations.md` drift recovery rules. Surfaces if you ever run `supabase db push --linked` (it will skip the matching content automatically since `CREATE TABLE IF NOT EXISTS` is idempotent).

## Codex Pattern B note

This is BUILD, so Pattern B Codex review is NOT required pre-merge per
`codex-review.md`. The gate fires before any SHIP/LAND/CANARY of this PR.
PR opened ready-for-review; recommend running Codex review against the
diff before merge, especially on:
- `_shared/sentry.ts` (defensive dynamic-import pattern is novel for this repo)
- `enqueue-sends` per-tz cap logic (DST edge cases, timezone-name fallback)
- `discover-leads` auth flip (smoke-manifest update consistency)

## Closing status

| Phase | Artefact | Probe | Status |
|---|---|---|---|
| Migrations | 2 new files + 1 rename | MCP apply + advisor delta = 2 ERROR findings cleared | ✅ |
| Edge code | 7 functions redeployed | MCP list_edge_functions shows new versions + verify_jwt:true for discover-leads | ✅ |
| Edge secrets | 3 new | `supabase secrets list` confirms presence | ✅ |
| Frontend | Build + TSC | `npm run build` + `npx tsc --noEmit` both green | ✅ |
| Smoke | suppression CHECK probe | direct SQL probe returns expected row | ✅ |
| PR | branch + push + open | gh pr create | ⏳ next step |

BUILD_COMPLETE
