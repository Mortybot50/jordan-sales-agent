# Warmup Network Audit — 2026-05-26

## Verdict: FAIL

The warmup network is not running and has never run. PR #64 (LeadFlow native sender Week 2) shipped the warmup *option* — schema, 200 templates, last_warmup_send_at column — but never built the worker or cron that actually fires inter-inbox emails.

## Findings

| Check | Result | Implication |
|---|---|---|
| Warmup Edge Function exists | ❌ No function named `*warmup*` or `*self-warmup*` in `supabase/functions/` | Nothing to send |
| Warmup cron job scheduled | ❌ 14 active leadflow crons, none for warmup | Nothing to trigger sends even if function existed |
| `warmup_threads` table populated | 0 rows | No pairing data |
| `warmup_messages` table populated | 200 rows (untouched template seed) | Templates ready but unused |
| `email_accounts.last_warmup_send_at` (all 4 inboxes) | NULL | No warmup ever sent |
| `email_send_events` warmup-tagged | 0 rows in last 7 days | Confirms nothing fired |
| `email_send_queue` inter-inbox sends | 0 rows ever | No pairs queued |
| Migration 20260519000003 docstring | "schema-only (no worker scheduled) — Option-preserving — no worker reads them yet" | Schema team flagged this at ship; never followed up |

## Inbox state (Australia/Melbourne)

| Mailbox | last_send_at | last_warmup_send_at | active |
|---|---|---|---|
| jordan@premiumwaterau.com | 2026-05-21 (smoke) | NULL | yes |
| jordan@premiumwaterau.com.au | 2026-05-21 (smoke) | NULL | yes |
| jordan@jordanmarziale.com | 2026-05-21 (smoke) | NULL | yes |
| jordan@jordanmarziale.com.au | 2026-05-21 (smoke) | NULL | yes |

5 days since last (smoke-only) send. 0 days of legitimate inter-inbox conversation history.

## Timing reality

Industry baseline for cold-send warmup is 14 days minimum, 21 preferred. If warmup starts NOW:

| Date | Daily warmup volume | Cold-send safe? |
|---|---|---|
| Day 1 (27/05) | 2 per inbox | No |
| Day 7 (02/06) | 5 per inbox | No |
| Day 14 (09/06) | 10 per inbox | **Earliest safe cold-send** |
| Day 21 (16/06) | 12 per inbox | Conservative cold-send |

The 18-19/05 cold-send target in `IDENTITY.md` is already missed.

## What's missing to fix

1. **Pairing seeder** — populate `warmup_threads` with the directed graph of which inbox pairs send to which. With 4 inboxes you get 12 possible directed pairs (4×3). Reasonable spec: each inbox sends to each of the other 3, roughly 3 outbounds per inbox per day at peak.

2. **`send-warmup-tick` Edge Function** — the worker. Picks an active warmup_thread, selects a warmup_message template, drafts a message with a real-looking subject + body (no marketing flags), sends through `send-via-smtp` with the warmup mailbox as From, updates `last_warmup_send_at`, logs `email_send_events` with `metadata.kind='warmup'`.

3. **pg_cron schedule** — every 30 min during 09:00-17:00 AEST, weekdays only. Daily volume ramps via a `warmup_day` column on `email_accounts` (or a sender-side counter): Day 1=2 sends, ramping +1/day to Day 14=10. Auto-replies (inbox-to-inbox reply chains 30-60% of the time) make the conversation graph look human.

4. **Reply behaviour** — when a warmup email lands in another LeadFlow inbox via IMAP poll, sometimes auto-reply (40% rate), sometimes star/mark-as-important (20% rate), sometimes ignore. The IMAP poller from PR #74 already runs every 5 min — extend it to handle warmup messages specially.

5. **Spam-marker protection** — every warmup email must include the `X-LeadFlow-Warmup: 1` header so we can ignore it on the inbound poller for real-reply detection.

## Recommendation

Dispatch a 1-day BUILD to wire up the 3 missing pieces. Start warmup immediately on completion. Earliest safe cold-send: 09/06.

If real cold-send needs to start earlier, the only alternative is paying for an external warmup service (Mailwarm, TrulyInbox, etc.) for $29-99/mo — but that defeats the "native, $0 recurring" goal of PR #62-66. Recommend building it.
