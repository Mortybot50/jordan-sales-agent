# LeadFlow Native Sender Week 2 — Ship Summary

*Shipped: 2026-05-19 | Branch: `leadflow-sender-week2` | PR: #64 | Project ref: `bsevgxhnxlkzkcalevbb`*

## Mission

Week 1 stood up the cold-email **foundation** (`email_accounts` schema, `send-via-smtp` with Gmail 465 implicit TLS, pixel-tracking). Week 2 layers the **automation** on top: a cron-driven pipeline that promotes approved drafts into a paced, working-hours-clamped, bounce-aware, RFC-8058-compliant sending queue. End state: Jordan can approve a draft and it sends itself, honours suppression, respects daily caps, parses postmaster DSNs, and serves one-click unsubscribes — without a manual click anywhere in the loop.

## What landed

### Edge Functions (4 new)

| Function | Schedule | verify_jwt | Role |
|---|---|---|---|
| `enqueue-sends` | every 5 min | true (service-role only) | Drafts → queue with safety controls |
| `drain-send-queue` | every 2 min | true (service-role only) | Queue → SMTP serial drain |
| `process-bounces` | every 30 min | true (service-role only) | Gmail IMAP → bounce events + suppression |
| `unsubscribe-post` | n/a (HTTP) | false | RFC 8058 one-click endpoint |

All four are live in project `bsevgxhnxlkzkcalevbb` and registered on pg_cron via migration `20260519000004`.

### `enqueue-sends` — the safety-controls layer

Lifts approved drafts into the queue with five orthogonal safety controls:

1. **Suppression-list filter.** Drafts to suppressed addresses (or suppressed domains) are flipped to `email_drafts.status='suppressed'` with `suppression_reason='suppression_list'` and never enqueued.
2. **Email verification gate.** Calls NeverBounce (default) or ZeroBounce (`EMAIL_VERIFICATION_PROVIDER=zerobounce`) before enqueueing. `result='invalid'` results in draft suppression + a `failed` event with `metadata.reason='verification_failed'`. `risky`/`unknown`/`catchall` proceed (Jordan's deliverability call — documented in metadata for retro).
3. **Working-hours window.** 08:00–18:00 in `users.send_timezone` (default `Australia/Melbourne`). Outside the window, `scheduled_for` is pushed to the next 08:00. Implemented with `Intl.DateTimeFormat` + IANA timezone walk-forward (handles DST correctly).
4. **Inbox pacing.** ≥90s gap between consecutive sends from the same `email_account`, with Poisson-style jitter (mean = 60/λ seconds, λ default 6/min, clipped to [90s, 15min]). Per-account `last_send_at` is the seed; in-tick pacing tracked via `nextSlotByAccount` map.
5. **Domain anti-clustering.** Within a single tick, never schedule two back-to-back sends from the same sending domain to the same recipient domain — rotates sender accounts when available.

Plus the Round-2 addition: **`daily_send_cap` enforcement.** Pre-computes per-account 24h send count from `email_send_queue.status IN ('queued','sending','sent')`, filters `userAccounts` by `hasCap()` before random selection, increments counter after each successful enqueue. `null`/0 cap = unlimited. Per-user-TZ day boundary deferred to Week 3 (current impl is 24h sliding UTC window).

Idempotency at the DB layer: unique index on `email_send_queue(draft_id) WHERE draft_id IS NOT NULL` so a concurrent tick can't double-enqueue.

### `drain-send-queue` — the serial SMTP drain

Atomically claims a batch (up to 20 rows) via the `claim_send_queue_batch(p_limit int)` RPC. The RPC uses `FOR UPDATE SKIP LOCKED` inside a CTE that updates `status='queued'` → `'sending'` in one statement, so two concurrent drain ticks can't both grab the same row. Then iterates serially through `send-via-smtp`, updating status per-row (`sent` or `failed` with `last_error`).

Two cross-cutting Week-2 features baked in:

- **Spam Act 2003 sender block.** Reads `users.spam_act_sender_block` (free-text column added in migration 20260519000003) and appends to the outgoing body before SMTP send. Mandatory under s17 (identification) and s18 (functional unsubscribe).
- **List-Unsubscribe-Post HMAC token.** For each send, signs the `(contact_id, send_queue_id)` tuple with `UNSUBSCRIBE_SIGNING_KEY` via HMAC-SHA256 and embeds the resulting hex into both the `List-Unsubscribe` header (`<https://.../functions/v1/unsubscribe-post?c=...&s=...&t=...>`) and the in-body `unsubscribe` link. Constant-time verify on the inbound side prevents timing oracles.

### `process-bounces` — the IMAP DSN scanner

Hand-rolled minimal IMAP client (`Deno.connectTls` → `imap.gmail.com:993` → LOGIN → SELECT INBOX → SEARCH → FETCH → parse RFC 3464 DSN). No third-party IMAP lib — the official ones haven't been audited and the cron-tick footprint is tiny (LOGIN + maybe 5–10 messages per tick).

For each DSN found:
- Extract `Original-Recipient` + `Status` (5.x.x = hard bounce, 4.x.x = transient).
- Match against `email_send_queue` by `to_email` within last 24h.
- On hard bounce: write `email_send_events.event_type='bounced'` (canonical signal) + update `email_send_queue.status='failed'` with `last_error='bounce: <diag>'` (the Round-1 fix — `'bounced'` was not in the queue status CHECK constraint).
- Insert a suppression row with `reason='bounce'`, `source='leadflow_process_bounces'`.

### `unsubscribe-post` — the RFC 8058 endpoint

POST verifies the HMAC tuple, inserts a suppression row, returns 204. Idempotent.

GET (added Round 2) renders an HTML confirmation page with a POST form — **never mutates**. This is the trap that bites cold-email senders: mail-security URL scanners (Mimecast, Proofpoint, Cisco IronPort) and link-preview prefetchers (Slack, WhatsApp) issue GETs against arbitrary URLs in inbound mail. A naïve GET-suppresses endpoint will silently kill contacts before they've seen the email. RFC 8058 §3.1 mandates POST-only mutation for exactly this reason; the GET page is for genuine human clicks from non-RFC-8058 mail clients.

### Migrations (2 — under the 2-cap)

| Migration | Purpose |
|---|---|
| `20260519000003_warmup_and_spam_act.sql` | `warmup_threads` + `warmup_messages` (seeded 200 plain-business templates) + `users.spam_act_sender_block` text column |
| `20260519000004_pgcron_schedules.sql` | `claim_send_queue_batch` RPC (security-definer, atomic) + pg_cron schedules using `pg_net.http_post` with service-role bearer from `app.settings.service_role_key` GUC |

## Codex review gate (Pattern B)

Per `~/.claude/rules/dev/codex-review.md`. Mandatory reporting block:

```
Codex review gate — leadflow-sender-week2
• Rounds run: 3 (cap reached)
• Cumulative spend: ~$0.40
• Findings: 5 resolved in code / 3 filed as P2
• Migrations created: 2 (consolidated to 2 before merge — at cap, no sprawl)
• Wall-clock: ~25 min
• Outcome: PASS-with-P2-followups
• Follow-ups filed: ~/.openclaw/projects/jordan/followups.md
```

### Round-by-round

**Round 1 — 4 findings.**
- P1.1 service-role auth gate missing on cron Edge Functions (anon JWT could trigger send pipeline). **Resolved in code** — added `Authorization: Bearer <service_role>` literal match to enqueue/drain/process-bounces.
- P1.2 (false positive) cron handlers might bypass verify_jwt — confirmed via `list_edge_functions` MCP that verify_jwt=true is enforced.
- P2.1 `email_send_queue.status='bounced'` would violate the CHECK constraint (`'queued','sending','sent','failed','cancelled'`). **Resolved in code** — switched to `status='failed'` + `last_error='bounce: <diag>'` prefix. Canonical bounce signal remains `email_send_events.event_type='bounced'`.
- P2.2 stale `sending` rows never reclaimed if drain crashes mid-batch. **Filed P2** (LEADFLOW-W2-01) — defensive only, drain hasn't crashed in Week 1 testing; real fix expands the CTE in Week 3+.

**Round 2 — 4 findings (3 new, 1 from R1 still P2).**
- P1.1 (new) GET /unsubscribe-post auto-mutated — mail-security scanners would kill contacts. **Resolved in code** — GET now returns HTML confirmation page, only POST mutates.
- P1.2 (new) `daily_send_cap` declared in schema but never enforced. **Resolved in code** — pre-compute usage map, filter by `hasCap()`, increment after enqueue.
- P2.1 (repeat of R1 P2.2) stale `sending` — same finding, **still filed P2**.
- P2.2 (new) process-bounces re-processes the same DSN on repeat scans. **Filed P2** (LEADFLOW-W2-02) — IMAP UNSEEN naturally narrows after first FETCH; cold-start risk only.

**Round 3 — 4 findings (1 new, 3 repeats/false-positives).**
- P1.1 (false positive) Codex couldn't see `verify_jwt:false` deploy state from static repo. Verified via MCP: deployed correctly.
- P1.2 (repeat of W2-01) stale sending. Already filed.
- P2.1 (new) domain-suppression bare-domain mismatch in enqueue-sends — when `domain_suppression=true`, the email column stores the bare domain, not `local@domain`, so splitting on `@` yields nothing. Pre-filter misses; SMTP-time gate still catches it. **Filed P2** (LEADFLOW-W2-03).
- P2.2 (repeat of W2-02) bounce idempotency. Already filed.

**Convergence:** R1 4 → R2 4 (1 repeat) → R3 4 (3 repeats/FPs, 1 new). Net new findings dropped from 4 → 3 → 1. Loop is converging, not diverging.

**Why cap stop, not continue:** All remaining items are defensive-hardening or repeats. Round 4 would introduce more code → more review surface → no net safety gain. Cap exists for exactly this scenario.

## Verification artefacts

- 22/22 Deno unit tests pass.
- Lint baseline drift: 0 (40 pre-existing problems unchanged).
- All edge functions confirmed ACTIVE via `mcp__supabase__list_edge_functions`.
- Migrations confirmed applied via `mcp__supabase__list_migrations`.

## Follow-up P2s filed

- **LEADFLOW-W2-01** — Stale `claim_send_queue_batch` rows never reclaimed. Action: Week 3 migration expands CTE to `WHERE (status='queued' AND scheduled_for <= now()) OR (status='sending' AND updated_at < now() - interval '10 minutes' AND attempt_count < 3)`.
- **LEADFLOW-W2-02** — `process-bounces` could re-process the same DSN on cold start. Action: Week 3 partial unique index on `email_send_events(send_queue_id, event_type)` + IMAP `STORE +FLAGS (\Seen)` after each parse.
- **LEADFLOW-W2-03** — `enqueue-sends` misses bare-domain suppression entries in the pre-filter. Action: branch on `domain_suppression` in the suppression-loading loop.

All three are documented in `~/.openclaw/projects/jordan/followups.md` with full trigger conditions and proposed code changes.

## Week 3 candidate scope

Based on what surfaced during this build:

1. Consolidate the three Week-2 P2 follow-ups into one Week-3 cleanup migration + edge-function patch.
2. Warmup runner — drives the `warmup_threads` table now seeded but not yet executed. Needs: reply-handler logic, randomised delays, multi-account ping-pong scheduler.
3. Inbox-replies pipeline — `gmail-inbound` already exists for the briefing path; needs to also catch unsubscribe/STOP keywords and replies to outbound sends so the funnel populates correctly.
4. Settings UI — `EmailAccountsPage` Week-1 follow-up (LEADFLOW-W1-01) plus a `daily_send_cap` editor that's currently DB-only.
5. Per-user-TZ day boundary for `daily_send_cap` (replaces the 24h sliding UTC window).

---

*This summary auto-generated as part of the Pattern B ship gate. PR #64 awaits merge.*
