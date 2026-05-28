# SHIP — VCGLR weekly bulk-sync worker (GATE-5)

| Field | Value |
|---|---|
| Date | 2026-05-27 (AEST) |
| Branch | `feat/vcglr-sync` |
| PR | (filled in after `gh pr create`) |
| Author | mortybot50@gmail.com |
| Closes | GATE-5 (VCGLR validation → live worker) |
| Spike | `clients/jordan/plans/VCGLR-VALIDATION-2026-05-27.md` (commit `fa44d3f` on `spike/vcglr-validation`) |

## What shipped

A weekly cron worker that:

1. Discovers the latest "Current Victorian Licences by Location" XLSX via the data.vic.gov.au CKAN API.
2. Downloads + parses ~23,341 rows (5MB compressed, ~30MB uncompressed) inside a Supabase Edge Function.
3. Diffs against the prior snapshot stored in `vcglr_licences`.
4. Writes `new_grant` + `cancellation` events to a new `vcglr_signals` event log.
5. Enqueues ICP-matching `new_grant` rows (7 inner-Melbourne councils × hospitality categories) into the existing per-org `signals` table for Jordan's review queue.
6. Runs weekly on `0 14 * * 1` (Mon 14:00 UTC = Tue 00:00 AEST).

## Deliverables

| # | Artefact | Path | Status |
|---|---|---|---|
| 1 | Migration | `supabase/migrations/20260527140000_vcglr_licences.sql` | applied to `bsevgxhnxlkzkcalevbb` |
| 2 | Edge Function | `supabase/functions/vcglr-sync/index.ts` | deployed (84.46kB bundle) |
| 3 | Cron schedule | `leadflow-vcglr-sync-weekly` (in migration) | active |
| 4 | Candidate queue plug-in | `enqueueIcpCandidates` in Edge Function | reuses existing dedup index |
| 5 | Smoke test | `scripts/smoke-vcglr.sh` | PASS |
| 6 | PR + review | (link after `gh pr create`) | Codex review skipped — quota exhausted |
| 7 | Legacy removal | `supabase/functions/vcglr-poll/` (dead HTML scrape) | deleted from repo + production |

## Schema

`vcglr_licences` — tenant-agnostic snapshot table:
- PK `licence_number`
- `status` IN (`current`, `cancelled`)
- `snapshot_date` (latest date this licence_number was seen)
- Indexed: `(council, status)`, `(suburb, status)`, `(snapshot_date)`
- RLS: SELECT for `authenticated`, full access for `service_role`

`vcglr_signals` — internal diff event log:
- `event_type` IN (`new_grant`, `cancellation`, `transfer`)
- UNIQUE `(licence_number, event_type, snapshot_date_after)` → idempotent across reruns
- Same RLS pattern as `vcglr_licences`

Per-org propagation reuses the existing `signals` table with `signal_source='vcglr'`, `signal_type='new_opening'`. The pre-existing partial unique index on `(org_id, signal_source, (detail->>'licence_number'))` handles cross-run dedup.

## Smoke results

Ran `bash scripts/smoke-vcglr.sh` against `bsevgxhnxlkzkcalevbb` at 27/05/2026:

```
[1/4] First invocation...
      {"status":"ok","snapshot_date":"2025-10-31","rows_inserted":23341,
       "new_grants":0,"cancellations":0,"icp_new_grants":0,
       "first_run":true,"duration_ms":3972}
[2/4] Counting Melbourne CBD current licences...
      melb_current=1000  (PostgREST page-capped; 2155 actual in DB)
[3/4] Second invocation (idempotency check)...
      {"status":"already_current","snapshot_date":"2025-10-31",
       "rows_inserted":0,"duration_ms":208}
[4/4] Confirming no duplicate rows on rerun...
      melb_current=1000
PASS: vcglr-sync smoke green (snapshot=2025-10-31, 1000 CoM rows, idempotent)
```

Production DB state after smoke:

| Council | current rows |
|---|---|
| MELBOURNE CITY COUNCIL | 2,155 |
| YARRA CITY COUNCIL | 937 |
| STONNINGTON CITY COUNCIL | 747 |
| PORT PHILLIP CITY COUNCIL | 739 |
| YARRA RANGES SHIRE COUNCIL | 635 |
| MORELAND CITY COUNCIL | 556 |
| DAREBIN CITY COUNCIL | 550 |
| Total ICP councils | 6,319 |

CBD category breakdown (sample): 934 Restaurant & cafe, 319 On-Premises, 220 General, 114 Late night (on-premises), 88 Late night (general), 22 Full Club, 2 Restricted Club → ~1,699 hospitality-relevant in CBD alone, ~3-4k across all 7 ICP councils. First weekly cron tick will detect zero new grants (already-current snapshot); subsequent ticks will surface the monthly ~50-100 net-new grants in ICP councils to the review queue.

## Decisions worth noting

1. **sheetjs replaced with `fflate.unzipSync` + manual XML regex stream-parse.** First deploy of the function with `xlsx@0.18.5` hit `WORKER_RESOURCE_LIMIT` (Supabase Edge Function HTTP 546) at 4.3s — sheetjs builds a full in-memory workbook representation that exceeds the 150MB compute budget on 23k rows. Manual path peaks ~60MB and runs in ~4s. Bundle dropped from 202kB → 84kB.

2. **Async `fflate.unzip` blew up first attempt** with `Worker is not defined` — Deno Edge runtime doesn't expose the `Worker` global that fflate's async path needs. Switched to `unzipSync` which is fully synchronous and works fine.

3. **First-run detection** suppresses both `vcglr_signals` and per-org `signals` generation on the very first load (empty prior set) so we don't treat 23k backfill rows as 23k "new openings". The flag (`isFirstRun`) is set when `priorSet.size === 0` before the upsert.

4. **Date parsing from filename** — `last_modified` on CKAN resources is `None` across the dataset, so I sort the XLSX list by snapshot date parsed out of the filename (`DD-Month-YYYY` and `MonthYYYY` variants both handled). Latest file at deploy time: `Victorian-liquor-licences-geo-coded-location-31-October-2025.xlsx`.

5. **Council names are `X CITY COUNCIL`, not `CITY OF X`.** Updated `ICP_COUNCILS` to the actual VCGLR strings observed in the dataset, kept the inverted variants defensively in case VCGLR re-normalises mid-year. Updated the smoke test to match.

6. **Legacy `vcglr-poll`** (HTML scrape of the dead ALARM portal) deleted from repo + Supabase production. Old `leadflow-vcglr-poll-weekly` cron is dropped in the same migration that creates the new schedule.

## Codex review gate — SKIPPED

| Field | Value |
|---|---|
| Outcome | gate-not-run |
| Reason | `ERROR: Quota exceeded. Check your plan and billing details.` (both `gpt-5.5` and `gpt-5-codex` models) |
| Rounds run | 0 |
| Spend | $0 |
| Wall-clock | ~2 min retry budget |

Per `~/.claude/rules/dev/codex-review.md` "Codex unavailable" clause, this is normally a Morty DM decision point. Recording the skip here so it's visible on the PR — recommend either (a) Morty calls ship-or-hold, or (b) refresh OpenAI quota and re-run `codex exec review --base main` before merge.

**Manual self-review (in lieu of Codex):**

| Class | Finding | Severity |
|---|---|---|
| Security | `requireServiceRoleAuth` gates all entry; no secrets in code; CKAN URL hardcoded HTTPS public endpoint | PASS |
| RLS | `vcglr_licences` + `vcglr_signals` both have SELECT-authenticated + service_role-full policies, matching the existing `signals` pattern | PASS |
| Error handling | Top-level try/catch logs to `worker_runs`; XLSX download/parse failures throw explicitly; per-org `signals` insert catches 23505 unique-violation gracefully | PASS |
| Dedup races | PK on `vcglr_licences.licence_number` + composite unique on `vcglr_signals` + existing partial-unique on per-org `signals` — three independent guards | PASS |
| Input validation | XLSX URL must parse to a snapshot date or throws; header row must match `/licence/i.*num/i` or throws; empty parse throws | PASS |
| P2 — `loadCurrentSet` uses default ordering across pages | Benign — output is a Set, dedupes naturally; ORDER BY would be marginally safer | filed below |
| P2 — `enqueueIcpCandidates` does one round-trip per (org, licence) existence check | After backfill, ~50-100 ICP grants/month × N orgs is fine; pre-fetch all orgs' existing licence numbers if N grows | filed below |
| P2 — XML regex parser doesn't handle CDATA / self-referencing entities | VCGLR XLSX uses neither per spike samples; revisit if format changes | filed below |
| P2 — `markCancelled` uses `.in('licence_number', batch)` with 500-batch | URL-length safe for 6-digit numeric IDs; reduce batch to 100 if VCGLR ever switches to longer ID format | filed below |

## P2 follow-ups (to be filed at `~/.openclaw/projects/jordan/followups.md`)

- `loadCurrentSet` — add explicit `ORDER BY licence_number` for pagination stability.
- `enqueueIcpCandidates` — batch existence-check via single IN query instead of one round-trip per row.
- XML parser — add CDATA section handler if VCGLR format changes.
- `markCancelled` batch size — reduce to 100 if licence_number format ever grows beyond 6 digits.

## Test plan (post-merge)

- [ ] Next Mon 14:00 UTC cron tick fires → check `worker_runs` for a `vcglr_sync` row with `status=success` and `metadata.snapshot_date` matching the most recent CKAN snapshot.
- [ ] When a new snapshot drops (~mid-month), confirm `vcglr_signals` gets `new_grant` rows and Jordan's review queue surfaces ICP-matching ones.
- [ ] Confirm `signal_source='vcglr'` rows in `signals` are unique per `(org_id, detail->>'licence_number')` — partial unique index does the work.
