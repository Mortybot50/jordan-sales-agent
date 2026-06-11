# AUDIT-FINDINGS.md

> Latest full audits: [`docs/audits/security-audit-2026-06.md`](docs/audits/security-audit-2026-06.md)
> · [`docs/audits/rls-matrix-2026-06.md`](docs/audits/rls-matrix-2026-06.md)
> Previous: [`docs/audits/week3-self-audit-2026-04-22.md`](docs/audits/week3-self-audit-2026-04-22.md)
> Last updated: 11/06/2026 AEST | Auditor: Claude (production-readiness sweep)

## Status Summary

| Severity | Count | Status |
|----------|-------|--------|
| P0 — Critical | 0 | 3 found 11/06 (RPC exposure, plaintext Gmail tokens, suppression cap) — **all fixed + probe-verified same day** |
| P1 — High | 0 | 5 found 11/06 (EF auth gaps, forgeable cron JWT, optional webhook token) — **all fixed + probe-verified same day** |
| P2 — Medium | 7 | Open, accepted, priority-ordered below |

## Open P2 backlog (priority order)

| # | Area | Item |
|---|------|------|
| P2-1 | api/unsubscribe | No per-IP rate limit on the manual form (enumeration already blocked by contact-match + uniform 200) |
| P2-2 | click-redirect | Destination URL travels as a scheme-validated query param; move to server-side stored links |
| P2-3 | Deps | Dev-chain npm vulns: `@vercel/node` bundled undici@5, `shadcn` CLI tree (6 high, 3 moderate — none ship to users) |
| P2-4 | Gmail | Google app verification out of scope by decision; `api/webhooks/gmail` stays fail-closed (503) until Pub/Sub goes live |
| P2-5 | Calendly | No webhook endpoint exists — integration dormant pending Jordan's Calendly PAT; tables ready |
| P2-6 | process-bounces | DSN content from the connected IMAP inbox is trusted (inbox compromise scenario) |
| P2-7 | poll-replies | TODO(P2): extract shared `_shared/imap-client.ts` (code duplication, not a defect) |

## Resolved history

- **11/06/2026 sweep** — see CHANGELOG 2026-06-11 entry + docs/audits/security-audit-2026-06.md.
  Also closed: legacy P2-1 (draft queue badge — shipped earlier as DraftQueueBadge),
  legacy P2-3 (morning-briefing pg_cron — shipped via pgcron_schedules + cp08 vault auth),
  the "PR pending" source-migration debt (`voice_note` CHECK literal; the two cron
  migrations had already been converted to the vault pattern), and the stale
  `vcglr-poll`/missing `send-warmup-tick` entries in scripts/smoke-manifest.yaml.
- **Week 3 (22/04/2026)** — all four Week-2 P1 bugs resolved; feature log in
  docs/audits/week3-self-audit-2026-04-22.md.

## Debt-marker scan (11/06/2026)

`rg "TODO|FIXME|HACK"` across src/ api/ supabase/functions/: **2 remaining**
after the sweep — `jordanScore.ts` TODO(Phase G) (peer-benchmark weights from
orgs table) and `poll-replies` TODO(P2) (shared IMAP client). Both logged above.
