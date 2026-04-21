# AUDIT-FINDINGS.md

> Full audit: [`docs/audits/week3-self-audit-2026-04-22.md`](docs/audits/week3-self-audit-2026-04-22.md)
> Previous: [`docs/audits/week2-self-audit-2026-04-21.md`](docs/audits/week2-self-audit-2026-04-21.md)
> Last updated: 22/04/2026 AEST | Auditor: Claude (automated self-audit)

## Status Summary

| Severity | Count | Status |
|----------|-------|--------|
| P0 — Critical | 0 | — |
| P1 — High | 0 | **All resolved in Week 3 Day 1** |
| P2 — Medium | 3 | Open (non-blocking) |

## Week 2 P1 Bugs → All Resolved ✅

| # | Location | Issue | Resolution |
|---|----------|-------|-----------|
| 1 | `src/hooks/useAuth.ts` | Auth loading never resolves if `getSession()` stalls | Fixed Day 1: `finally { setLoading(false) }` |
| 2 | `src/lib/queries/dashboard.ts` | Reply rate KPI always shows `—` | Fixed Day 1: aligned activity_type constants |
| 3 | `src/main.tsx` | Full stack traces in production ErrorBoundary | Fixed Day 1: NODE_ENV guard added |
| 4 | Pipeline | Mobile pipeline shows "Loading…" permanently | Fixed Day 1: DealListView data flow repaired |

## Current P2 Bugs (Week 4 backlog)

| # | Location | Issue |
|---|----------|-------|
| P2-1 | Nav sidebar | Draft queue count badge not showing on nav item |
| P2-2 | Gmail OAuth | Requires Google app verification — needs Morty's privacy policy URL |
| P2-3 | Supabase | No pg_cron job for morning briefing — manual setup needed post-deploy |

## Week 3 Features Delivered

- AI draft generation (Claude Sonnet 4.6) with review queue
- Gmail OAuth + Pub/Sub inbound email ingestion
- Calendly HMAC-signed webhook + auto stage advancement
- `compute_lead_score()` Postgres function + INSERT trigger
- Hospitality-native ICP (suburb chips, licence type, spend tier)
- Extended venue fields on contact detail
- Briefing ICP filter toggle
- `send-morning-briefing` Edge Function (Resend)
- Loading skeletons on all major pages
- Demo data refreshed, user profile seeded
