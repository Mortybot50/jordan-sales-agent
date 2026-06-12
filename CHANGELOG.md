# Changelog

## 2026-06-13 — Passwordless email-OTP login

Jordan was told a magic-link sign-in exists; it didn't, and he couldn't get
in. The login page is now a two-step passwordless flow: enter email → receive
a 6-digit code → enter code → signed in. The code leads (browser-agnostic —
PKCE emailed links break when opened outside the requesting browser); the
email still carries a same-device link as a convenience. Unknown addresses
get the same neutral "a code is on its way" line (no account enumeration),
`shouldCreateUser: false` plus server-side `disable_signup` keep strangers
out, and password sign-in stays available behind a de-emphasised toggle
until demo@ retires.

Server side (all via Management API, nothing left for the dashboard): auth
email now goes out through Resend SMTP as "LeadFlow <login@premiumwaterau.com>"
— the **.com** is the Resend-verified domain; .com.au is not (550 on first
probe). Site URL fixed from `localhost:3000` to `https://premiumwaterau.com.au`
(emailed links previously deep-linked to localhost), redirect allow-list set,
OTP length 8 → 6, email rate limit 2/hr → 30/hr, magic-link template rewritten
to lead with the code. Proven live end-to-end before deploy: OTP requested →
delivered in 3s → verified → session returned, via a temporary auth user on an
IMAP-readable cold-send mailbox (created and deleted inside one probe run).

Tests: 6-spec Playwright suite for the two-step UI (runs unauthenticated,
never consumes the email rate limit); 62/62 unit tests; full prod smoke
35 passed / 3 known skips. Gotcha for next time: PATCHing a single `smtp_*`
field on `/config/auth` silently wipes the rest of the SMTP block — always
send the full block.

## 2026-06-12 — Jordan feedback build (board, detail, leads inbox, send funnel)

Addresses Jordan's three problems: the pipeline didn't show lead state at a
glance, the detail panels were data dumps, and the scraper had no front-end.

**Pipeline board (A):** DealCard rebuilt around the business name with a
temperature chip, last-contact, last-action, sequence/replied status and a
one-line notes summary — scannable at 65 cards/column. Board filter row
(heat / outreach / source). 8 stages + de-emphasised Hold. KPI sums + averages
now exclude NULL-value deals; the $800 quick-add default is gone.

**Temperature + PST re-triage (B):** new `deals.temperature` (hot/warm/cold,
manual-overridable) with a tested classifier wired into reply-intent. The 317
PST mailbox-import deals were re-triaged from their thread metadata: correct
stage (Contacted 61 / Replied 245 / Closed 11), temperature (cold 64 / warm
148 / hot 105), business-name titles, real last-contact dates, and the $800
placeholder values nulled (hand-made deals untouched). Full before-state
backed up; reversible.

**Detail redesign (C):** ContactDetailPage + DealDrawer pass the 3-second
test — large name with temperature + stage context, a loud next-step banner
(red when overdue), empty fields collapsed behind an expander, and a real
chronological interaction timeline (PST contacts surface their mailbox thread).

**Leads inbox (D):** `/leads/inbox` gives the scraper a face — pending venues
with source, ICP, contact + verification status, and Approve/Discard/Defer
(row + bulk). Approve runs the full chain server-side (crawl → internal
verify → deal → enrol → first draft) with per-step feedback. Discard suppresses
the venue's emails under a distinct `lead_rejected` source. The legacy
`auto_sourced_candidates` table was consolidated into `venues.review_status`
and dropped — one review model.

**Approve = sent, visibly (E):** approved drafts no longer vanish — an Outbox
rail shows queued → sending ~time → sent. Bulk approve, plus loud
pending-count nudges on the dashboard and morning briefing. Fixed a regression
where approve falsely reported "daily cap reached" (a locked-down RPC called
from the client); sender selection is now owned solely by the enqueue cron.
Proven with a live end-to-end send — first real send since 19/05.

**Stage rename:** Closed Won → Closed, Closed Lost → Lost; Demo Completed /
Negotiation / Pending Install / Installed retired (deals remapped).

**Login migration (F1):** `jordan@purezza.com.au` now has a full profile and
owns all the data; the old `demo@` login stays valid until Jordan confirms
the switch.

**Security (F3):** per-IP rate limit on the manual unsubscribe form;
click-redirect destinations moved server-side (open-redirect closed, `?url=`
no longer trusted) via a new `tracked_links` table; process-bounces only acts
on DSNs that link to a real send (no more inbox-driven mass-suppression).

**Internal fix:** `requireServiceRoleAuth` now accepts Supabase's new non-JWT
secret-key format — it had been silently 401-ing every Edge-Function→Edge-
Function internal call since the platform key migration.

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
