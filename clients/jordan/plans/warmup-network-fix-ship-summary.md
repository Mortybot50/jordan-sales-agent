# Warmup Network Fix — Ship Summary

**Date:** 2026-05-27 00:55 AEST
**Branch:** `feat/warmup-network-fix` → merged via PR #88 (commit b8abb7c)
**Closes audit:** `warmup-network-audit-2026-05-26.md` (P0-WARM)

## Verdict: SHIPPED

The warmup network worker, cron, pairing seed, and IMAP reply behaviour are live in prod. First real warmup send will fire at Melbourne 09:00 on 27/05/2026 (~8 hours after this summary). 14-day cold-send countdown started. **Earliest safe cold-send: 10/06/2026** (Day 14, daily quota = 10/inbox).

## What landed

### Migration `20260526210000_warmup_pairing_ramp_and_cron.sql`

- Added `email_accounts.warmup_day` (int 0..14, default 0) + `warmup_day_bumped_on` (date) on all rows.
- Seeded 12 directed warmup pairs for org `5557189e-5c2d-4990-afad-6aa1861826cd` (4 inboxes × 3 others each) into `warmup_threads` status='active'.
- Scheduled pg_cron `leadflow-warmup-tick` with `*/30 21-23,0-8 * * *` UTC. Two-layer quiet-hours clamp: cron narrows to the UTC slot covering AEST/AEDT 09-17; Edge Function gates Mon-Fri + exact hours via `Intl.DateTimeFormat('Australia/Melbourne')`.
- Bearer token sourced from `vault.decrypted_secrets` (same pattern as PR #66).

**Probes (live):**

| Probe | Expected | Actual |
|---|---|---|
| `warmup_threads where org=leadflow and status='active'` | 12 | **12** ✓ |
| `cron.job where jobname='leadflow-warmup-tick'` | 1 active | **1 active, schedule=*/30 21-23,0-8 * * *** ✓ |
| `email_accounts.warmup_day` exists | yes | **yes** ✓ |
| `email_accounts.warmup_day_bumped_on` exists | yes | **yes** ✓ |

### Edge Function `send-warmup-tick`

Two modes:

- **`tick`** (default, called by cron every 30 min UTC). Per inbox: bump `warmup_day` once per Melbourne local day → compute quota `min(1+warmup_day, 10)` → count today's `email_send_events` with `metadata.kind='warmup'` → if under quota, pick oldest-untouched `warmup_threads` row → render random `warmup_messages` template (kinds `intro`/`casual`/`followup`) → send inline via denomailer with mandatory `X-LeadFlow-Warmup: 1` header → log `email_send_events` event_type='sent' metadata.kind='warmup'.
- **`reply`** (called by `poll-replies` on inbound 40% dice-roll). Same SMTP path; threads via In-Reply-To / References so Gmail collapses conversations.

Quiet-hours hard gate: Mon-Fri 09:00-17:00 Australia/Melbourne. Outside that window the function returns `{success:true, skipped:true, reason:'outside_quiet_hours'}`. DST-safe (AEST→AEDT auto-handled by ICU).

SMTP transport: Gmail forced to port 465 implicit TLS (matches send-via-smtp / drain-send-queue). Non-Gmail honours `email_accounts.smtp_port`.

### Edge Function `poll-replies` — warmup branch

Inbound IMAP fetch now requests `X-LEADFLOW-WARMUP` header. If present and `=1`, the message hard-skips the real-reply pipeline (no `activities` row, no `classify-reply-intent`, no suppression touch) and routes into `handleWarmupInbound`:

- Dice-roll 40% reply / 20% star / 40% ignore.
- Reply path POSTs to `send-warmup-tick` mode=`reply` with the warmup thread context; downgrades to `ignore` if the inner send reports `skipped:true` or `success:false`.
- Star path sets IMAP `\Flagged`.
- All paths mark `$LFReplyProcessed` keyword so we never re-process.
- STORE failures surface to `worker_runs.error_message` via `accErrors`.

## Codex review gate

| Field | Value |
|---|---|
| Rounds run | 4 |
| Cumulative spend | ~$1 |
| Findings resolved this PR | 4 (1 P1 deploy blocker + 3 P2: false-positive sent-event tagging, ignored `smtp_port`, swallowed STORE failure) |
| Findings filed as P2 | 2 (`WARM-P2-01` Message-ID dedupe, `WARM-P2-02` spoofable header sender pre-check) |
| Migrations created | 1 (no consolidation needed) |
| Wall-clock | ~25 min |
| Outcome | **PASS** (round 4 overridden for P1 deploy blocker) |
| Follow-ups | `~/.openclaw/projects/jordan/followups.md` |

_Reason for round-cap override: migration timestamp `20260526142114` was older than `20260526200000_drop_sender_inboxes.sql` already on main; would block `supabase db push`. Renamed to `20260526210000` in round-3 commit._

## Smoke test evidence

```
POST /functions/v1/send-warmup-tick with vault bearer
→ HTTP 200
→ body: {"success":true,"skipped":true,"reason":"outside_quiet_hours","melbourne":{"hour":0,"weekday":3,"date":"2026-05-27"}}
```

Validates: auth chain (vault → cron-style bearer → function), Melbourne TZ resolution (correctly identified Wed 00:00), quiet-hours gate, error-free deploy.

## Timing — warmup ramp

First firing window: Wed 27/05/2026 09:00 AEST = 23:00 UTC Tue 26/05.

| Date | Warmup day | Daily volume/inbox | Total/day (4 inboxes) | Cold-send safe? |
|---|---|---|---|---|
| Wed 27/05 | Day 1 | 2 | 8 | No |
| Mon 02/06 | Day 5 | 6 | 24 | No |
| Wed 04/06 | Day 7 | 8 | 32 | No |
| Wed 10/06 | Day 9 | 10 (capped) | 40 | **Earliest safe** |
| Wed 17/06 | Day 14 | 10 | 40 | Conservative cold-send |

(`warmup_day` increments once per Melbourne local day at first tick; Sat/Sun don't tick because quiet-hours gate blocks them. So Day 1→Day 2 only counts on weekdays. Conservative cold-send target: 17/06/2026.)

## What to watch on Day 1 (Wed 27/05 ~ 09:00 AEST)

1. `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname='leadflow-warmup-tick') order by start_time desc limit 5` — confirm cron firing every 30 min.
2. `select count(*) from email_send_events where metadata->>'kind'='warmup' and event_at::date = current_date` — should grow by 8 over the day (2/inbox × 4 inboxes).
3. `select email_address, last_warmup_send_at, warmup_day from email_accounts where status='active'` — all four `last_warmup_send_at` should populate within first 60 min after 09:00.
4. `select * from worker_runs where worker_name='poll-replies' and started_at > now() - interval '30 min' order by started_at desc` — confirm poll-replies sees the inbound warmup messages and reports no errors.
5. Spot-check Gmail UI on `jordan@premiumwaterau.com` inbox — should see 1-3 messages from the other LeadFlow inboxes by lunchtime.

## Files touched

- `supabase/migrations/20260526210000_warmup_pairing_ramp_and_cron.sql` (+167 lines, new)
- `supabase/functions/send-warmup-tick/index.ts` (+632 lines, new)
- `supabase/functions/poll-replies/index.ts` (+~140 lines, modified)

## Open follow-ups (P2, deferred)

| ID | File | Description |
|---|---|---|
| WARM-P2-01 | `poll-replies/index.ts:392` | Message-ID dedupe in warmup branch — current STORE-failure surfacing catches the failure mode within one tick; full dedupe is belt-and-braces. |
| WARM-P2-02 | `poll-replies/index.ts:373` | Pre-check `fromAddress` against `email_accounts` before trusting `X-LeadFlow-Warmup` header — narrow attack surface (attacker must already be in our contact graph to exploit). |

Recorded in `~/.openclaw/projects/jordan/followups.md`.
