# VCGLR scrape validation — GATE-5

**Date:** 2026-05-27
**Spike branch:** `spike/vcglr-validation`
**Status:** **GO** — but the right approach is bulk-download via Vic Government open-data portal, not a scrape of the legacy VCGLR ALARM search portal.

## Verdict (TL;DR)

**Go.** A monthly CSV/XLSX of every current Victorian liquor licence is published on `data.vic.gov.au` under **CC-BY 4.0**, addressable via a stable CKAN JSON API. 23,341 active licences statewide (Oct 2025 snapshot), 6,684 of them in Jordan's inner-Melbourne ICP councils. All six target fields extract cleanly. No HTML scrape needed, no robots issues, no ToS friction. Estimated build effort: **~4 hours** for a weekly worker that pulls latest snapshot, diffs vs prior, and writes new-appearance / disappearance signals to `venues` keyed on `licence_number`.

## Rebrand check — where the data actually lives in 2026

| Domain | Status | Use |
|---|---|---|
| `liquor.vic.gov.au` (old VCGLR) | 301 → `vic.gov.au/liquor-control-victoria` | Marketing/info only |
| `vgccc.vic.gov.au` | 200 OK | Gambling/casino arm — **not relevant** for liquor licences |
| `liquor.vcglr.vic.gov.au/alarm_internet/` | 200 OK (ASP.NET, session-based) | Per-licence public search, painful to scrape |
| `www.vic.gov.au/victorian-liquor-licences-location` | 200 OK | **Canonical landing page for monthly bulk download** |
| `discover.data.vic.gov.au/dataset/victorian-liquor-licences-by-location` | 200 OK + CKAN API | **Programmatic discovery — use this** |

The 2024 VCGLR → Liquor Control Victoria rebrand moved the consumer-facing UI to `vic.gov.au` but kept the legacy ALARM search portal alive on `liquor.vcglr.vic.gov.au`. The bulk dataset, however, is published independently on the Victorian Government open-data portal.

## Source of truth — primary URLs

- **Dataset landing page:** https://www.vic.gov.au/victorian-liquor-licences-location
- **CKAN metadata API:** https://discover.data.vic.gov.au/api/3/action/package_show?id=victorian-liquor-licences-by-location
- **Latest snapshot (30 April 2026):** https://www.vic.gov.au/sites/default/files/2026-05/Current_Victorian_Licences_By_Location-30-April-2026.xlsx
- **Naming pattern:** `Current_Victorian_Licences_By_Location-<DD>-<Month>-<YYYY>.xlsx`

Discover the latest URL each run via CKAN API rather than guessing the filename — the worker should hit `package_show`, parse `result.resources[].url`, sort by date, take the newest.

## Method — bulk download, not scrape

**Use:** weekly cron worker → CKAN API → download newest XLSX → parse rows → upsert into `vcglr_licences` table (or directly into `venues` enrichment) → diff vs last week's snapshot.

**Don't use:** the ALARM ASP.NET search portal at `liquor.vcglr.vic.gov.au/alarm_internet/`. It's session-based, form-driven, and would require thousands of HTTP round-trips to enumerate the same data the XLSX gives us in one request. No benefit.

## Sample extracted record (row 6 of Oct 2025 snapshot)

| Field | Value | Source column |
|---|---|---|
| Licence number (dedup key) | `31907352` | A — Licence Num |
| Licensee (legal entity) | `CONTINENTAL COWES MANAGEMENT PTY LTD` | B — Licensee |
| Venue name (trading name) | `NORTH PIER HOTEL` | C — Trading As |
| Licence category | `General Licence` | D — Category |
| Trading address | `5-8 THE ESPLANADE, COWES 3922` | H/K/L |
| Lat/long | `-38.44823, 145.24127` | M/N |
| Council | `BASS COAST SHIRE COUNCIL` | T |
| Region | `Gippsland` (Regional) | U/V |
| Trading hours | `Trading to 1am` | E |
| Capacity | `382` | G |
| Gaming licence | `N` | W |

All six fields from the spike spec are present.

## Caveats — what the bulk file does NOT give us

1. **No `status` column** — the file is a snapshot of *current/active* licences only. Cancelled, suspended, surrendered licences are dropped, not flagged. **Implication:** to detect cancellations we must diff month-over-month (disappearance = cancelled/surrendered/transferred).
2. **No `effective_date` / `grant_date` column** — we cannot tell from a single snapshot which licences are new this month. **Implication:** same diff approach — first-appearance in snapshot N+1 vs snapshot N = "newly granted (or first time on the published list)".
3. **Monthly cadence, end-of-month snapshot** — plan promised "weekly", but the source publishes monthly (~12 days lag between snapshot date and file upload). **Implication:** poll weekly, but expect ~30-day signal latency. New licence grants will land in our pipeline 0–45 days after grant. Acceptable for outbound (better than nothing); not real-time.
4. **No legal-entity ABN / phone / email** — we get licensee company name only. Enrichment to ABN/phone/email still needs ABR + web scrape downstream (same as Wave A).
5. **Inline strings in XLSX (no sharedStrings.xml)** — small parser quirk; standard libraries (`xlsx`, `exceljs`) handle it transparently.

## Volume estimate

- **23,341** active liquor licences statewide (Oct 2025)
- Of which **hospitality-relevant** (excluding Packaged Liquor / Pre-retail / Producer's / Remote Seller's / BYO):
  - Restaurant and cafe Licence: 6,544
  - General Licence: 2,047
  - On-Premises Licence: 2,033
  - Late night (general / on-premises): 761
  - Club licences (Full / Restricted): 1,454
  - **Hospitality total: ~12,839** (55% of all licences)
- **Inner-Melbourne ICP councils** (Melbourne / Yarra / Stonnington / Port Phillip / Moreland / Darebin / Yarra Ranges):
  - **6,684 active licences** across these 7 councils — strong ICP overlap
- **Expected new grants / changes per month:** estimate 100–300 net additions statewide based on typical regulator throughput; ~50–150 in inner-Melbourne ICP. Real number will come out of the first month-over-month diff.

## Update frequency signal

- CKAN extract field: *"stocktake of all active liquor licences across Victoria...at the first of each month"*
- Publishing lag: Apr 30 2026 snapshot was uploaded 12 May 2026 (12 days)
- Refresh cadence in the worker: **weekly poll** of CKAN API; download only when the resource's `last_modified` is newer than last fetch. Stays under any reasonable rate-limit (1 hit/week).

## Legal / ToS / robots

- **Licence:** Creative Commons Attribution 4.0 International (`license_id: "cc-by"`, `isopen: true`). Permits commercial use, redistribution, derivative works with attribution.
- **`www.vic.gov.au/robots.txt`:** `User-agent: *` with `Crawl-delay: 2`. Bulk file paths under `/sites/default/files/` are not disallowed. SemrushBot blocked; standard UA fine.
- **`liquor.vcglr.vic.gov.au/robots.txt`:** 404 (no robots.txt published).
- **No automated-access prohibition** found on either the dataset landing page or the CKAN metadata. Standard CC-BY attribution string is all that's required.
- **Attribution:** include `© State of Victoria (Liquor Control Victoria), CC BY 4.0` in any UI surface that displays licence data downstream, plus a link to the licence and the dataset.

## Recommended next step

**Ship as a weekly cron worker, ~4 hours engineering effort:**

1. Migration: `vcglr_licences` table keyed on `licence_number` (PK), with columns mirroring the XLSX headers plus `first_seen_at`, `last_seen_at`, `removed_at`, `org_id` for RLS.
2. Edge Function `worker-vcglr-sync`:
   - Hit CKAN `package_show` → pick newest XLSX resource.
   - Skip if `last_modified` ≤ last run's `last_modified` (idempotent).
   - Stream-download XLSX, parse rows (use `exceljs` or `xlsx` — already used elsewhere? confirm before adding dep).
   - Upsert all rows; mark rows present last run but absent now as `removed_at = now()`.
   - Write events to `vcglr_signals`: `{type: 'new_licence' | 'removed', licence_number, prior_seen_at, fingerprint}`.
3. Cron: weekly Mon 06:00 AEST via vault-authenticated `pg_cron` (same pattern as Wave B sourcing dispatcher).
4. Downstream ICP filter: existing `clients/jordan` venue dedup matches on `licence_number` + suburb + venue_type → triggers Jordan outbound flow on `new_licence` events in scope.
5. Smoke: `scripts/smoke-vcglr-sync.sh` — invokes worker against staging, asserts row count > 20,000, asserts at least one row in Melbourne CBD, asserts no rows have null `licence_number`.

**Dependency call:** confirm `exceljs` or `xlsx` is acceptable to add to `package.json` (spike instructions said no new deps — production worker will need one, ~200KB). Alternative: write a 60-line inline-XML parser (proven in this spike — see commands run on the snapshot).

**Out of scope for this spike (filed as P2 follow-ups):**
- Per-licence effective-date enrichment via ALARM portal scrape (only needed if month-over-month diff isn't fine-grained enough for Jordan's outbound cadence — revisit after first month of production data).
- Historical backfill from 2015 archives (the diff-over-time approach only needs the prior month; older snapshots are nice-to-have for cohort analysis, not blocking).

## Files touched by this spike

None in `src/`. Validation work done in `/tmp/vcglr-sample.xlsx` (5.3 MB, deleted after report). No new deps, no schema changes, no commits beyond this report.
