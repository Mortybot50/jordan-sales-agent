# AUDIT-FINDINGS.md

> Full audit: [`docs/audits/week2-self-audit-2026-04-21.md`](docs/audits/week2-self-audit-2026-04-21.md)
> Audited: 21/04/2026 AEST | Auditor: Claude (automated self-audit)

## Quick Reference

| Severity | Count | Status |
|----------|-------|--------|
| P0 — Critical | 0 | — |
| P1 — High | 4 | Unresolved |
| P2 — Medium | 6 | Unresolved |
| ESLint errors | 3 | Unresolved |

## P1 Bugs (fix before next demo)

| # | Location | Issue |
|---|----------|-------|
| 1 | `src/hooks/useAuth.ts` | Auth loading never resolves if `getSession()` stalls — app shows permanent "Loading…" spinner. Add `finally { setLoading(false) }`. |
| 2 | `src/lib/queries/dashboard.ts` | Reply rate KPI always shows `—` — query filters `activity_type = 'email_sent'` but data uses `'email_outbound'`. |
| 3 | `src/main.tsx:43–50` | Full stack traces render in production ErrorBoundary — no `NODE_ENV` guard. |
| 4 | Pipeline | Mobile pipeline route shows "Loading…" permanently — mobile demo is broken. |

## P2 Bugs (Week 3 backlog)

| # | Location | Issue |
|---|----------|-------|
| 1 | `src/pages/ContactDetailPage.tsx:425` | Google Maps embed uses deprecated `?output=embed` URL — renders as grey box. |
| 2 | `tsconfig.app.json` | Missing `"strict": true` — no `strictNullChecks`, `noImplicitAny`. |
| 3 | `supabase/migrations/` | `auth_org_id()` always falls back to DB lookup — N+1 per RLS-gated query. |
| 4 | Pipeline | Only 7 of 9 planned stages exist — "Replied", "Site Visit", "Demo Completed" missing. |
| 5 | Dashboard | Warm Leads and Follow-ups Due KPIs are 0 due to seed data timing. |
| 6 | Settings | Email + Calendly save silently (no success toast or error handling). |

## Top Week 3 Recommendations

| # | Size | Recommendation |
|---|------|---------------|
| 1 | S | Fix `useAuth.ts` loading bug (`finally` block) |
| 2 | S | Fix reply rate KPI (`email_outbound` → consistent activity type) |
| 3 | S | Gate stack trace in ErrorBoundary behind `NODE_ENV !== 'production'` |
| 4 | M | Add missing pipeline stages (Replied, Site Visit, Demo Completed) |
| 5 | M | Replace Google Maps embed with Mapbox Static API or Maps Embed API v2 |
| 6 | M | Add AI email draft generation (Week 2 plan item, currently stub) |
| 7 | L | Fix mobile layout — pipeline and auth loading on viewport change |
| 8 | L | Add `org_id` JWT claim to eliminate `auth_org_id()` N+1 |
| 9 | XL | Build Briefing AI narrative generation (currently 4 static cards) |

---

*See full audit for browser screenshots, SQL evidence, ESLint output, and plan alignment details.*
