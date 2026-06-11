# Changelog

## 2026-06-11 — Production-readiness sweep (security, demo purge, tests, UX)

**Decisions on record:**
- **Instantly.ai is retired.** The native SMTP sender (`email_accounts`,
  `email_send_queue`, `send-via-smtp`, warmup ramp) is the only production
  send path. The webhook endpoint, export script, env key and all UI/doc
  references are removed. Prod probe before removal: zero rows ever
  originated from the Instantly webhook.
- **Apollo is dropped, superseded by native sourcing** (Google Places + VCGLR
  + ABR + contact crawler). It was never integrated; stale comments referring
  to a future Apollo import are rewritten.

**Security (full report: docs/audits/security-audit-2026-06.md):**
- Locked down SECURITY DEFINER RPCs (anon could previously claim/read queued
  outbound email via `/rest/v1/rpc/claim_send_queue_batch`) — migration
  `20260611071849_function_execute_lockdown`.
- Five Edge Functions moved from effectively-public to service-role-gated
  (`send-morning-briefing`, `generate-learning-digest`, `abr-lookup`,
  `publication-poll`, `ensure-intent-idx`); `gmail-inbound` token now
  mandatory; `create-demo-user` deleted from code and remote.
- Gmail OAuth tokens: plaintext-fallback paths removed; refreshed access
  tokens now encrypted (AES-256-GCM, fail-hard).
- CSP flipped from Report-Only to enforced (+ `worker-src blob:` for the map,
  Sentry ingest allowed).
- RLS verified across all 50 tables — no gaps (docs/audits/rls-matrix-2026-06.md).

**Send-safety:**
- Suppression firewall no longer truncates at PostgREST's 1000-row cap
  (live list is 6,535 entries; the frontend gate was missing 5,535 of them).
  Sequence enrolment now uses the same paginated loader. Suppression UI
  shows the true count.

**Demo data:** 121 demo rows purged from prod (backup at
`~/workspace/leadflow-audit/demo-data-backup-2026-06-11.sql`); seed files are
marked LOCAL ONLY; the operator login account is retained.

**Tests:** vitest unit suites (38) for suppression/emailHygiene/fieldOutcomes/
send-window + Playwright route-walk smoke suite (26) wired to `npm test` /
`npm run test:e2e`; 75 pre-existing node:test cases still green.

**UX:** sidebar regrouped (CRM / Outbound / Intelligence / Settings / Admin),
orphaned routes now reachable (Sending Analytics, Suppression list, Workers,
Postmaster Tools); heavy routes code-split (main bundle 2,487 kB → 872 kB,
maplibre loads only on /field); deal titles linkified; auth console noise
silenced.

## Unreleased

- fix(genprompt): trim base system prompt to thin scaffold; voice + style now exclusively owned by users.voice_rules
