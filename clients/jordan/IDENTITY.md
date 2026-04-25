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

Current prod bundle: `index-BVoiUAVx.js` on `https://jordan-sales-agent.vercel.app`.

## Hard constraints

- Demo password stays as-is.
- Phase F Dark Anchor tokens are the only design vocabulary — no new tokens without a reskin.
- Multi-tenant from day 1: every new table gets `org_id` and RLS via `auth_org_id()`.
- No Mapbox — MapLibre + OSM only.
- API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) live in Supabase secrets; absence must degrade gracefully, never block the build.

## Operating model

- Conventional commits: `feat(scope):`, `fix(scope):`, `chore(scope):`.
- Every feature lands via PR → squash-merge to main.
- Ship summaries live at `clients/jordan/plans/<feature>-ship-summary.md` and include a smoke-proof table.
- Deploys are Vercel (production at the apex alias). After merging, verify the served bundle hash and grep for new feature strings.
- Edge Functions deploy to Supabase project `bsevgxhnxlkzkcalevbb`.

## What's next

Nothing scoped yet — this is a checkpoint, not a queue.
