# Org hygiene audit — 2026-05-26

**Project:** `bsevgxhnxlkzkcalevbb` (LeadFlow prod)
**Branch:** `wave-a/address-hygiene`
**Status:** Audit + draft migration. **NOT applied to prod.**

## TL;DR

The LeadFlow DB holds **4 orgs**, only **1 of which is real** (`Purezza AU` / Jordan's working org). The other 3 are leftover test/demo/smoke-test artefacts from April with no business value. Draft migration `20260526130000_org_consolidation.sql` deletes the 3 non-canonical orgs in a single transaction. CASCADE FKs (all 43 org-scoped tables) clean up automatically.

Brief said 3 orgs; inventory shows 4 (a smoke-test org from 24/04 was missed in the initial count). Adding it to the cleanup.

## Orgs found

| org_id | name | created_at | owner user(s) | Decision |
|---|---|---|---|---|
| `5557189e-5c2d-4990-afad-6aa1861826cd` | Purezza AU | 2026-04-21 | `demo@jordan-sales-agent.test` (Jordan Smith) | **CANONICAL — keep** |
| `683ea245-a8c8-4ce3-ae8a-c9065c328346` | demo | 2026-04-21 | _none_ (orphan) | DELETE CASCADE |
| `bb7f954d-1489-40a6-854c-50826b724845` | jordan | 2026-04-27 | `jordan@purezza.com.au` (unused login) | DELETE CASCADE |
| `cadd6ff1-8660-40a0-a6c5-6081e33e0b2a` | smoke-test-voice-rules-1777022348 | 2026-04-24 | _none_ | DELETE CASCADE |

## Row inventory (all 43 org-scoped tables)

Tables with no rows in any non-canonical org are omitted. Empty cells = 0 rows.

| table | 5557189e (canonical) | 683ea245 (orphan) | bb7f954d (jordan@purezza login) | cadd6ff1 (smoke) |
|---|---:|---:|---:|---:|
| activities | 41 | 1 | | |
| auto_sourced_candidates | 9 | | | |
| calendly_events | 2 | | | |
| claude_conversations | 1 | | | |
| claude_messages | 2 | | | |
| contacts | 17 | 1 | | |
| deals | 21 | | | |
| draft_edits | 1 | | | |
| email_accounts | 4 | | | |
| email_drafts | 10 | | | |
| email_send_events | 10 | | | |
| email_send_queue | 4 | | | |
| email_signature_templates | 2 | | | |
| inbox_placement_seeds | 4 | | | |
| lead_scores | 27 | | | |
| lead_search_runs | 2 | | | |
| lead_searches | 1 | | | |
| monthly_gates | 1 | | | |
| pipeline_stages | 13 | 12 | 10 | 13 |
| reopening_events | | 3 | | |
| reply_scan_runs | 1048 | | | |
| sender_inboxes | 4 | | | |
| sequence_steps | 6 | | | |
| sequences | 2 | | | |
| signals | 29 | 26 | 26 | 26 |
| suppression_list | 3 | | | |
| tasks | 10 | | | |
| users | 1 | | 1 | |
| venue_observations | | 5 | | |
| venues | 43 | 22 | 22 | 22 |

`worker_runs` holds 1088 rows with `org_id IS NULL` (global jobs); FK is `SET NULL` so unaffected.

## Salvageability assessment

### `683ea245` ("demo" orphan)

Holds the most non-canonical rows. Closer look:

- **1 contact:** `Smith Street Espresso (lead)` — no email, no phone. Created 24/04/2026 by Reopening Radar promotion (the early stub-mode test run before GATE-5 validation). No business value.
- **1 activity:** `note` type, subject `"Promoted from Reopening Radar"`, attached to that same contact, no `deal_id`. Same test artefact.
- **5 venue_observations + 3 reopening_events:** all from the April Reopening Radar stub-mode test (project memory: "shipped 25/04/2026 in stub mode; live scraping blocked on GATE-5"). Pre-real-data.
- **22 venues:** test-fixture names — `Agnii`, `Bakestand`, `Bar Kaeru`, `Bloomwood`, `Bruno`, `Cherry Tree Hotel`, `Dingo`, `Interlude`, etc. No address, no place_id. Seed data, identical fingerprint across the 3 non-canonical orgs.
- **12 pipeline_stages, 26 signals:** default seed data emitted by an early bootstrap migration. Canonical org has its own (richer) versions.

**Decision: DELETE CASCADE.** Nothing salvageable; no real business data was ever attached.

### `bb7f954d` ("jordan" / `jordan@purezza.com.au`)

- **1 user:** `jordan@purezza.com.au` (full_name: "jordan"). Created 27/04/2026. Has never owned any business row (no contacts, deals, activities, email_accounts, etc.). This is a stray signup; Jordan logs in as `demo@jordan-sales-agent.test` in practice.
- **22 venues / 10 pipeline_stages / 26 signals:** seed data fingerprint, same as the other non-canonical orgs.

**Decision: DELETE CASCADE.** `auth.users` row for `jordan@purezza.com.au` is out of scope (separate schema, not org-scoped) — left intact. If Jordan ever wants to use that login, he can; he'll just need to be invited into the canonical org.

### `cadd6ff1` ("smoke-test-voice-rules-1777022348")

Name says it: created 24/04/2026 as a one-off CI smoke test of voice rules. No user, no business data, only seed data (13 pipeline_stages, 22 venues, 26 signals).

**Decision: DELETE CASCADE.** Pure test artefact.

## Consolidation strategy

No `UPDATE`-to-repoint statements needed. Every non-canonical row is either:
- Default seed data (pipeline_stages, signals, venues, venue_observations, reopening_events) — re-created per-org by an old bootstrap migration; canonical org already has its own copies.
- A single Reopening Radar stub-mode test artefact (1 contact + 1 activity) from before GATE-5 validation — no real business value.
- A stale user (`jordan@purezza.com.au`) that has never owned a business row.

All 43 FKs from org-scoped tables to `orgs.id` are `ON DELETE CASCADE` (verified via `information_schema.referential_constraints`). A single `DELETE FROM orgs WHERE id IN (...)` cleans every related row atomically.

## Migration

File: `supabase/migrations/20260526130000_org_consolidation.sql`

Wrapped in `BEGIN; ... COMMIT;`. Single statement:

```sql
DELETE FROM orgs WHERE id IN (
  '683ea245-a8c8-4ce3-ae8a-c9065c328346',
  'bb7f954d-1489-40a6-854c-50826b724845',
  'cadd6ff1-8660-40a0-a6c5-6081e33e0b2a'
);
```

## Apply discipline

**This migration has NOT been applied to prod.** Two-step sign-off before apply:

1. Jordan reviews this audit doc (you're reading it) and confirms he doesn't want any of the non-canonical data preserved.
2. Morty applies via `supabase db push` or Management API `apply_migration` against project `bsevgxhnxlkzkcalevbb`.

If anything looks off, change the migration before applying — once `DELETE CASCADE` runs, the rows are gone (no soft-delete column on `orgs`).

## Post-apply expected state

- `SELECT count(*) FROM orgs;` → **1** (only `5557189e`).
- Every org-scoped row count for non-canonical orgs → **0**.
- `auth.users` row for `jordan@purezza.com.au` unaffected (separate schema, not deleted by this migration).
- `worker_runs` unaffected (FK is `SET NULL`, rows already had `org_id IS NULL`).
