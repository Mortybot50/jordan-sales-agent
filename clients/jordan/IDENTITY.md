# Jordan — Sales Agent Identity

## Who Jordan is

Jordan is a hospitality sales rep covering Victorian venues — pubs, clubs, restaurants, cafes. Day looks like: morning briefing, draft queue, a few hours on the road doing walk-ins, end-of-day pipeline review.

LeadFlow is Jordan's whole-of-day surface — not a CRM module bolted on, but the primary tool.

## Where we are right now

**Shipped to main (25/04/2026):**

- Auth hardening — iOS Safari PWA cold-start no longer hangs on stale sessions.
- Field Mode (`/field`) — map-based day-trip planner, route optimisation, walk-in visit logging.
- Voice-note capture — hold-to-record on Field Mode + Contacts, with Whisper transcription and Claude Haiku entity extraction.
- Reopening Radar (`/reopening-radar`) — passive watcher for VIC venues going CLOSED → ACTIVE (stub mode pending GATE-5/VCGLR validation).
- Dashboard Interactive (#11) — every KPI card, card header, stage row and recent-activity row deep-links into its source view with the right filter pre-applied. Bundled with an iOS-Safari fix for the warm-leads horizontal-scroll gesture.

**Shipped to main (26/04/2026):**

- Pricing model + Monthly Gate (`feature/pricing-model-and-gate`) — sellable product catalogue (`/catalogue`) for Purezza / Culligan / Zip HydroTap; deals now carry ACV/TCV/commission computed by trigger from `weekly_price × 52 × term/12 × pct`; `monthly_gates` table + daily forfeit cron at 00:30 AEST; dashboard hero gate card + Pipeline ACV/TCV/Held bar + Pending Installs + Earned This Year cards; install lifecycle on the deal drawer. Default commission 7%, ex-GST throughout.

Current prod bundle: `index-FfsK5snX.js` on `https://jordan-sales-agent.vercel.app`.

## Hard constraints

- Demo password stays as-is.
- Phase F Dark Anchor tokens are the only design vocabulary — no new tokens without a reskin.
- Multi-tenant from day 1: every new table gets `org_id` and RLS via `auth_org_id()`.
- No Mapbox — MapLibre + OSM only.
- API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) live in Supabase secrets; absence must degrade gracefully, never block the build.

## Cold-send decisions

- **30/05/2026 — Spam Act footer locked to ABN-only.** Authorised by Jordan via WhatsApp 30/05/2026 12:20 AEST ("Ship it"). Footer text verbatim: `Jordan Marziale - ABN 78 180 361 897 - Reply STOP or click the unsubscribe link above.` Real ABN is 78 180 361 897. No street address — Jordan declined to put his home address on bulk commercial send; ABN identifies him uniquely via the public ABR lookup. Residual Spam Act 2003 s.17 risk (ACMA could read "accurate information about the individual or organisation that authorised the sending" as requiring an address as well as ABN) was raised and accepted in writing. Revisit if ACMA position changes or a business PO Box is stood up. Encoded in `supabase/migrations/20260530000001_spam_act_sender_block_jordan_real_abn.sql`; supersedes the placeholder seed at `20260519000003_warmup_and_spam_act.sql` lines 213–224.

## Operating model

- Conventional commits: `feat(scope):`, `fix(scope):`, `chore(scope):`.
- Every feature lands via PR → squash-merge to main.
- Ship summaries live at `clients/jordan/plans/<feature>-ship-summary.md` and include a smoke-proof table.
- Deploys are Vercel (production at the apex alias). After merging, verify the served bundle hash and grep for new feature strings.
- Edge Functions deploy to Supabase project `bsevgxhnxlkzkcalevbb`.

## Latest session handoff

**Wave 3A — 15/05/2026.** Closed the two Codex review v2 residuals from Wave 1A.

- **PR #60 — smoke v2 (Management API rewrite)** — SHIPPED to main as `4007352`. `scripts/smoke-api.sh` rewritten as a two-phase guard: Phase A reads the Edge Function roster via `GET /v1/projects/{ref}/functions` (zero handler calls, no side-effect risk) and asserts every function is `ACTIVE` with the expected `verify_jwt` flag; Phase B keeps the original PostgREST + JWT login coverage but now exits 2 if creds are missing (CI cannot silently skip). Codex review: PASS at round 3 after addressing round-1 (lost coverage / coerced bool / JSON error handling) and round-2 (silent Phase B skip).
- **PR #61 — overlay React-mounted signal** — OPEN, NOT MERGED. `src/main.tsx` sets `window.__leadflow_react_mounted__ = true` after `createRoot().render()`; `index.html` overlay timer reads it first, DOM children second, with the ceiling raised from 5s → 8s. Build green; flag baked into bundle (`grep -c` returns 1 in JS, 2 in index.html). **Blocked at the Codex review gate: OpenAI quota exceeded — Codex returned `ERROR: Quota exceeded` on both attempts.** Holding the merge per `~/.claude/rules/dev/codex-review.md` ("Codex unavailable / timeout → ask Morty whether to ship without review; don't silently skip"). Awaiting human-in-the-loop call.

Summary file: `/tmp/gstack-jordan-wave3a-summary.md`.

## What's next

Nothing scoped yet — this is a checkpoint, not a queue.
