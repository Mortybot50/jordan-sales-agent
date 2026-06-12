# AUDIT-FINDINGS.md

> Latest full audits: [`docs/audits/security-audit-2026-06.md`](docs/audits/security-audit-2026-06.md)
> · [`docs/audits/rls-matrix-2026-06.md`](docs/audits/rls-matrix-2026-06.md)
> Previous: [`docs/audits/week3-self-audit-2026-04-22.md`](docs/audits/week3-self-audit-2026-04-22.md)
> · Session 2 (12/06): [`~/workspace/leadflow-audit/COMPLETION-REPORT-2.md`]
> Last updated: 12/06/2026 AEST | Auditor: Claude (Jordan feedback build)

## Status Summary

| Severity | Count | Status |
|----------|-------|--------|
| P0 — Critical | 0 | session-1 P0s fixed 11/06; none new |
| P1 — High | 0 | session-1 P1s fixed 11/06; none new |
| P2 — Medium | 4 | **3 closed 12/06** (P2-1/2/6); 4 remain |

## Closed 12/06 (session 2)

| # | Area | Resolution |
|---|------|-----------|
| P2-1 | api/unsubscribe | **Closed.** Per-IP token bucket (5/min) on the manual path; signed links exempt. Prod-probed 5×200 → 429. |
| P2-2 | click-redirect | **Closed.** `tracked_links` table stores destinations server-side; `?url=` no longer read. Open-redirect verified closed (`evil.example.com` not honored). |
| P2-6 | process-bounces | **Closed.** A DSN only suppresses when it links to a real `email_send_queue` send; forged/misdirected daemon mail with no match is logged + skipped. |
| — | EF→EF auth | **Closed (latent P0, found 12/06).** `requireServiceRoleAuth` rejected Supabase's new non-JWT secret-key format → every internal EF→EF call silently 401'd since the platform key migration. Now byte-matches the runtime key; all 13 svc functions redeployed; approve chain verified end-to-end. |

## Open P2 backlog (priority order)

| # | Area | Item |
|---|------|------|
| P2-3 | Deps | Dev-chain npm vulns: `@vercel/node` bundled undici@5, `shadcn` CLI tree (6 high, 3 moderate — none ship to users) |
| P2-4 | Gmail | Google app verification out of scope by decision; `api/webhooks/gmail` stays fail-closed (503) until Pub/Sub goes live |
| P2-5 | Calendly | No webhook endpoint exists — integration dormant pending Jordan's Calendly PAT; tables ready |
| P2-7 | poll-replies | TODO(P2): extract shared `_shared/imap-client.ts` (code duplication, not a defect) |

## Migration history drift (P2, 12/06)

This project is MCP-migration-managed (`apply_migration` stamps `version=now()`),
so local filename-versions have never matched remote history versions. CLI
`db diff`/`migration repair` parity needs DB connectivity (blocked: no IPv6
route) **and** is gated (MIGRATION-WIPE-001 guard → Morty WhatsApp approval).
Not mutated this session. All session migrations have committed local files;
live schema fully sourced; advisors show 0 new issues. One-time gated repair
to renumber history remains. See COMPLETION-REPORT-2.md §5.

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
