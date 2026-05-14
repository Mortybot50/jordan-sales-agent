# DB-P1-01 — Migration history drift resolution

**Date:** 2026-05-14
**Source finding:** `docs/audits/CONSOLIDATED-AUDIT-2026-05-11.md` §3 / DB-P1-01
**Project ref:** `bsevgxhnxlkzkcalevbb`

## Audit scope (verbatim)

> Repro: remote 34 versions vs local 33 files. 6 local-only (`20260427000001…`, `…000002…`, `…000003…`, `20260428000001…`, `20260511102600_oauth_state_nonces_rls.sql`, `20260511103200_normalise_suppression_emails.sql`) + 3 remote-only (`20260425134731 pricing_model_triggers_and_stages`, `20260426003635 add_deal_next_step`, `20260426033634 add_draft_kind_to_email_drafts`). Version timestamps drift on every shared pair.
>
> Fix: `supabase db pull` to regenerate local files matching remote, OR `supabase migration repair --status applied <version>` for the 6 local-only.

## Pre-repair verification of local-only files

Verify-before-claim probe against live schema (rather than blanket `repair --status applied`, which would have stealth-lost truly-pending DDL):

| Version | File | Live state | Action |
|---|---|---|---|
| 20260427000001 | salesforce_csv_import.sql | `contacts.metadata` MISSING; `activities_activity_type_check` already broader than this migration would set | Apply `contacts.metadata` column add only. Skip the check-constraint DDL (live constraint already includes `import`, `voice_note`, `daily_cap_reached`, `draft_suppressed` — replaying would strip 3 of those + break an existing `voice_note` row). |
| 20260427000002 | activities_intent_idx.sql | `idx_activities_intent` exists | No-op; mark applied. |
| 20260427000003 | users_public_slug.sql | `users.public_slug` column exists | No-op; mark applied. |
| 20260427000004 | sequence_engine.sql | All 22 DDL components verified — see exhaustive table below | No-op; mark applied. (Not in audit list; sibling to 000001-3.) |
| 20260427000005 | sequence_tick_cron.sql | `cron.job` row `leadflow-sequence-tick` schedule `15 * * * *` active | No-op; mark applied. (Not in audit list; sibling to 000004.) |
| 20260428000001 | calendly_setup_state.sql | `users.calendly_webhook_registered_at` + `users.calendly_test_booking_at` MISSING | Apply both column adds. |
| 20260511102600 | oauth_state_nonces_rls.sql | `service_role_full_access` policy present (PR #43) | No-op; mark applied. |
| 20260511103200 | normalise_suppression_emails.sql | Zero `+alias` rows post-normalisation (PR #44) | No-op; mark applied. |

## Exhaustive DDL verification (addresses Codex P1 round 1)

Round 1 of `codex review` flagged that "tables exist" was insufficient evidence for `20260427000004 sequence_engine.sql` because the migration adds columns, constraints, indexes, policies, and `email_drafts` links beyond the scaffold tables. Re-ran a per-component probe against live (via `mcp__supabase__execute_sql` against `information_schema`, `pg_constraint`, `pg_indexes`, `pg_policies`, `pg_proc`, `pg_trigger`).

### 20260427000004 sequence_engine.sql — all 22 DDL components

| # | Component | Live state |
|---|---|---|
| c1  | `sequences.created_by_user_id` column | ✅ |
| c2  | `sequences_org_isolation` RLS policy | ✅ |
| c3  | `sequence_steps.prompt_instructions` column | ✅ |
| c4  | `sequence_steps.delay_days` default = `0` | ✅ |
| c5  | `sequence_steps_step_number_check` constraint | ✅ |
| c6  | `sequence_steps_delay_days_check` constraint | ✅ |
| c7  | `sequence_steps_seq_step_unique` unique constraint | ✅ |
| c8  | `sequence_steps_org_isolation` RLS policy | ✅ |
| c9  | `sequence_enrollments.contact_id` column | ✅ |
| c10 | `sequence_enrollments.enrolled_by_user_id` column | ✅ |
| c11 | `sequence_enrollments.next_step_due_at` column | ✅ |
| c12 | `sequence_enrollments.last_step_fired_at` column | ✅ |
| c13 | `sequence_enrollments.last_status_message` column | ✅ |
| c14 | `sequence_enrollments.failure_count` column | ✅ |
| c15 | `sequence_enrollments.current_step` default = `0` | ✅ |
| c16 | `sequence_enrollments_status_check` (v1 vocab) | ✅ |
| c17 | `sequence_enrollments_seq_contact_active_idx` | ❌ — **expected**, see note below |
| c17b | `sequence_enrollments_contact_seq_unique` (PR #53 broader idx covering active+paused) | ✅ |
| c18 | `sequence_enrollments_due_idx` partial index | ✅ |
| c19 | `sequence_enrollments_org_isolation` RLS policy | ✅ |
| c20 | `email_drafts.sequence_enrollment_id` column | ✅ |
| c21 | `email_drafts.sequence_step_number` column | ✅ |
| c22 | `email_drafts_sequence_enrollment_idx` partial index | ✅ |

Note on c17: The migration originally created `sequence_enrollments_seq_contact_active_idx` (active-only). PR #53 (`20260514120000_sequence_enrollments_active_paused_unique.sql`, BE-P1-02, merged earlier today) explicitly drops that index and replaces it with the broader `sequence_enrollments_contact_seq_unique` covering both `active` and `paused`. c17=false is the correct post-PR-#53 state; c17b=true confirms the superseding index is in place. Nothing missing.

### 20260427000002 activities_intent_idx.sql

| # | Component | Live state |
|---|---|---|
| m2 | `idx_activities_intent ON activities ((metadata ->> 'intent'))` | ✅ |

### 20260427000003 users_public_slug.sql

| # | Component | Live state |
|---|---|---|
| m3a | `users.public_slug` column | ✅ |
| m3b | UNIQUE constraint on `users.public_slug` | ✅ |
| m3c | `public_user_profiles` view | ✅ |
| m3d | `GRANT SELECT ON public_user_profiles TO anon` | ✅ |

### 20260511102600 oauth_state_nonces_rls.sql

| # | Component | Live state |
|---|---|---|
| m4 | `service_role_full_access` policy on `oauth_state_nonces` | ✅ |

### 20260511103200 normalise_suppression_emails.sql

| # | Component | Live state |
|---|---|---|
| m5a | `normalise_suppression_email()` function | ✅ |
| m5b | `suppression_list_normalise_email` trigger | ✅ |
| m5c | `email_drafts_suppression_guard()` patched (references `v_norm` introduced in this migration) | ✅ |
| m5d | Zero `+alias` rows lingering in `suppression_list` | ✅ (0 rows) |

### 20260427000001 salesforce_csv_import.sql + 20260428000001 calendly_setup_state.sql

Both pre-backfill: see "DDL backfill executed" section below. Post-backfill probe returned `metadata_ok=true, webhook_ok=true, booking_ok=true`.

### 20260427000005 sequence_tick_cron.sql

| # | Component | Live state |
|---|---|---|
| m7 | `cron.job` row `leadflow-sequence-tick` schedule `15 * * * *` active=true | ✅ |

Total: 31 DDL components verified live across the 8 repaired versions (+ 1 known-superseded by PR #53). Tracker repair is now backed by per-component evidence, not "tables exist".

## DDL backfill executed

```sql
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS calendly_webhook_registered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS calendly_test_booking_at TIMESTAMPTZ NULL;
```

Applied via `mcp__supabase__execute_sql` (DDL only, no tracker write). Post-apply verify SQL returned `metadata_ok=true, webhook_ok=true, booking_ok=true`.

**Deliberately omitted:** the `activities_activity_type_check` constraint replay from `20260427000001_salesforce_csv_import.sql`. Live constraint def (verified via `pg_get_constraintdef`) is strictly broader than the local migration would set:

```text
live  : email_sent, email_opened, email_clicked, reply_received, call_note,
        meeting_note, task_completed, stage_change, bounce, unsubscribe,
        email_inbound, email_outbound, deal_created, note, meeting_booked,
        email_manual, import, voice_note, daily_cap_reached, draft_suppressed

local : email_sent, email_opened, email_clicked, reply_received, call_note,
        meeting_note, task_completed, stage_change, bounce, unsubscribe,
        email_inbound, email_outbound, deal_created, note, meeting_booked,
        email_manual, import
```

Replaying would have stripped `voice_note`, `daily_cap_reached`, `draft_suppressed` and crashed on an existing row with `activity_type='voice_note'`.

## Tracker repair

```bash
supabase migration repair --status applied \
  20260427000001 20260427000002 20260427000003 20260428000001 \
  20260511102600 20260511103200 --linked
# Repaired migration history: [...] => applied

supabase migration repair --status applied \
  20260427000004 20260427000005 --linked
# Repaired migration history: [20260427000004 20260427000005] => applied
```

Two extra versions (`20260427000004`, `20260427000005`) were marked alongside the audit's 6 because they're siblings with the same drift pattern — DDL already on live (sequence_enrollments + sequence_steps tables; `leadflow-sequence-tick` cron) but the version stamps weren't in the remote tracker.

## Out of scope (broader L2 drift — separate work)

The audit explicitly notes "Version timestamps drift on every shared pair". This PR does NOT close that broader drift; only the audit's named 6 + 2 siblings are reconciled. Remaining mismatches after this PR:

- **Shared-pair version-stamp drift** — every local `YYYYMMDD00000N` synthetic stamp has a remote counterpart with the actual `supabase db push` timestamp. Same DDL, different version columns. Touched in this PR only where the audit named entries explicitly.
- **3 remote-only entries** — `20260425134731 pricing_model_triggers_and_stages`, `20260426003635 add_deal_next_step`, `20260426033634 add_draft_kind_to_email_drafts`. Need `supabase db pull <version>` per-entry, or a manual local-file recreation. Not in this PR.
- **20260504000001, 20260510000001, 20260510235959, 20260514120000** — local-only shared-pair drift siblings (have corresponding remote entries with different stamps). PR #53's 20260514120000 had its DDL applied via MCP earlier today, generating the remote stamp `20260514122414`.

These remain on the broader L2 cleanup backlog. The DB-P1-01 audit-scoped fix is closed.

## Post-repair state

`supabase migration list --linked` shows the audit's 6 + 2 sibling entries paired on both sides:

```text
20260427000001 | 20260427000001 | 2026-04-27 00:00:01
20260427000002 | 20260427000002 | 2026-04-27 00:00:02
20260427000003 | 20260427000003 | 2026-04-27 00:00:03
20260427000004 | 20260427000004 | 2026-04-27 00:00:04
20260427000005 | 20260427000005 | 2026-04-27 00:00:05
20260428000001 | 20260428000001 | 2026-04-28 00:00:01
20260511102600 | 20260511102600 | 2026-05-11 10:26:00
20260511103200 | 20260511103200 | 2026-05-11 10:32:00
```

`supabase db push` in a fresh checkout will now correctly identify these 8 versions as already-applied (their rows are in `supabase_migrations.schema_migrations`) and skip them. The remaining shared-pair drift still misleads `db push` for the rest of the history — flagged for broader L2 follow-up.

(Note: `supabase db reset --linked` is destructive — it drops the linked database and reapplies all local migrations from scratch. It does **not** consult the repaired tracker. Don't run it against the live project to "verify" this repair.)
