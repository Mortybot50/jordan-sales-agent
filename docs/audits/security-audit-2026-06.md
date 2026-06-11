# Security Audit — 2026-06-11

> Scope: 31 deployed Edge Functions, all Vercel `api/` routes, public-endpoint
> abuse surfaces, webhook signature verification, secrets handling, RLS +
> SECURITY DEFINER functions, CSP, dependencies.
> Method: source review + live probes against `bsevgxhnxlkzkcalevbb` and
> production. Every fix below was applied and probe-verified the same day.
> Companion doc: [rls-matrix-2026-06.md](rls-matrix-2026-06.md).

## Fixed this audit (was-broken → now-verified)

| # | Severity | Finding | Fix | Probe |
|---|---|---|---|---|
| 1 | P0 | `anon` could execute every SECURITY DEFINER function via `/rest/v1/rpc/*` — incl. `claim_send_queue_batch` (claims AND returns queued outbound email bodies) | Migration `20260611071849_function_execute_lockdown`: revoke anon/authenticated, default-deny future functions | anon RPC → `42501 permission denied`; service_role retains; crons green post-change |
| 2 | P0 | `api/webhooks/gmail.ts` stored the **refreshed Gmail access token in plaintext** (`access_token_encrypted: accessToken`) | Now `encryptToken()` via fail-hard `_lib/token-crypto` | code path unit-typechecked; gmail_connections had 0 rows (no legacy plaintext) |
| 3 | P0→P1 | `api/oauth/gmail/callback.ts` had a local `encryptToken` that **silently fell back to plaintext** when `TOKEN_ENCRYPTION_KEY` unset | Inline helper deleted; imports fail-hard `_lib/token-crypto` (throws if key missing/short) | tsc + deploy |
| 4 | P1 | `send-morning-briefing` + `generate-learning-digest` cron mode had **no auth** (deployed `verify_jwt=false`) — anyone could trigger all-user email sends / Anthropic spend | `requireServiceRoleAuth` added to cron paths; redeployed `verify_jwt=true` | anon POST → 401; cron ticks at 07:00/07:15 succeeded with vault JWT |
| 5 | P1 | `abr-lookup` was public with **service-role DB writes from caller-supplied ids** (and zero callers in the codebase) | `requireServiceRoleAuth` added; `verify_jwt=true` | anon POST → 401 |
| 6 | P1 | `publication-poll` relied on decode-only `requireServiceRoleAuth` while deployed `verify_jwt=false` — **forgeable** with an unsigned `role=service_role` JWT | Redeployed `verify_jwt=true` (gateway signature check now precedes role check) | forged unsigned JWT → 401 |
| 7 | P1 | `gmail-inbound` shared-token check was optional (unset env → unauthenticated) | Token now mandatory; fails closed 503 when unset | code + deploy (function still `verify_jwt=true` until Pub/Sub goes live) |
| 8 | P1 | Frontend suppression firewall (`getSuppressionSet`) and the sequence-enrolment check both **truncated silently at PostgREST's 1000-row cap** (live list: 6,535) | Paginated loader; enrolment path now uses it; unit tests pin the behaviour | vitest 38/38; UI shows true count |
| 9 | P2 | 8 functions had mutable `search_path` (advisor WARN) | Pinned `search_path='public'` in the same migration | advisors re-run clean on those lints |
| 10 | P2 | `ensure-intent-idx` deployed `verify_jwt=false` (its byte-match key check was sound) | Flipped `verify_jwt=true` for consistency | deploy |
| 11 | P2 | CSP was Report-Only | Enforced; added `worker-src 'self' blob:` (maplibre workers) and `https://*.sentry.io` (DSN live in prod env) | post-deploy probe on /field + headers |
| 12 | P2 | `create-demo-user` deployed and public | Deleted (local + remote) | → 404 |

## Edge Function auth matrix (post-fix, 31 deployed)

| Category | Functions | Mechanism |
|---|---|---|
| User JWT (`verify_jwt=true`, RLS via caller token) | claude-chat, field-route-optimize, generate-draft, reopening-radar-manual, voice-transcribe, geocode-batch, geocode-venues-batch, send-via-smtp (test/manual), send-morning-briefing (manual mode: JWT subject must match body.user_id), generate-learning-digest (single-user mode: same) | gateway signature + `auth.getUser()` |
| Service-role only (`verify_jwt=true` + role-claim check in code) | audit-snapshot, classify-reply-intent, crawl-venue-contacts, discover-leads, drain-send-queue, enqueue-sends, notify-warm-reply, poll-replies, process-bounces, reopening-radar-poll, sequence-tick, sourcing-cron-tick, send-warmup-tick, vcglr-sync, publication-poll, abr-lookup, generate-learning-digest (cron), send-morning-briefing (cron), gmail-inbound (plus mandatory shared token), ensure-intent-idx (byte-match service key) | pg_cron passes the vault-stored service-role JWT (`vault.decrypted_secrets`, cp08 pattern) — **no hardcoded keys anywhere**; verified all 14 HTTP cron jobs read from vault |
| Public by design (`verify_jwt=false`) | click-redirect, pixel-track, unsubscribe-post | see abuse analysis below |

`scripts/smoke-manifest.yaml` updated to match; the smoke script diffs the live
roster against it on every run.

## Public endpoint abuse analysis

- **click-redirect** — validates destination scheme (http/https only): no open
  redirect to `javascript:`/`data:`. Destination travels in the signed email we
  generated, not attacker-controlled storage. P2 (accepted): URL is a query
  param, so redirect targets are visible in email bodies; server-side stored
  links are a future tightening.
- **unsubscribe-post** — RFC 8058; HMAC-SHA256 over the (contact_id,
  send_queue_id) tuple, constant-time compare, silent 204 on bad token (no
  enumeration oracle). Brute-force space 2^256.
- **pixel-track** — UUID-validated input only; nothing reflected; fire-and-forget
  insert. P2 (accepted): no rate limit; worst case is noisy open events.
- **api/unsubscribe (Vercel)** — token-gated one-click OR manual form that only
  suppresses when the email matches an existing contact (no mass-unsubscribe of
  strangers, no existence oracle — always 200). P2 logged: no per-IP rate limit.

## Vercel api/ matrix

| Route | Auth | Notes |
|---|---|---|
| api/places/autocomplete + details | Supabase JWT + 30/min per-user in-memory rate limit | Places key server-side only — not burnable anonymously. P2: in-memory bucket map unbounded (Lambda lifetime caps practical impact) |
| api/email-accounts/save | JWT + org membership | SMTP passwords AES-256-GCM via fail-hard token-crypto |
| api/route/* (5) | Shared `authenticate()` helper: JWT + org resolve, RLS via user client | clean |
| api/oauth/gmail/start + callback | JWT; HMAC-signed single-use state nonce (10-min TTL, deleted on verify) | tokens encrypted at rest (fix #3) |
| api/webhooks/gmail | Google OIDC JWT (JWKS signature, audience + service-account email + email_verified), disabled-closed in prod when env unset | forged-payload probes → 503 (fail-closed; Pub/Sub not yet live) |
| api/unsubscribe | HMAC token or contact-match | see above |

## Webhooks

- **Gmail Pub/Sub**: OIDC verification implemented (jose + Google JWKS,
  issuer/audience/service-account checks). Probed prod with no-auth and
  forged-JWT payloads → both rejected (503: env not configured, fail-closed).
- **Calendly**: **no live endpoint exists** — only DB tables + setup-state
  migration. The integration is dormant pending Jordan's Calendly PAT. The 2
  calendly_events rows in prod were demo seeds (purged 11/06). No surface to
  attack; revisit when wired.
- **Instantly**: endpoint deleted (retired; 0 rows ever originated from it).
  `INSTANTLY_WEBHOOK_SIGNING_KEY` removed from Vercel env.

## Secrets

- Repo-wide scan (src/, api/, supabase/, scripts/): **no hardcoded keys** —
  no vendor prefixes (sk-, AIza, ghp_, re_, xox), no connection strings outside
  `process.env`/`Deno.env`. `.env` files not read, per policy.
- `SUPABASE_SERVICE_ROLE_KEY` never referenced in `src/` (frontend).
- Token crypto: AES-256-GCM (`api/_lib/token-crypto.ts`), fail-hard key loader,
  per-encryption random IV + auth tag. Used by email-accounts/save, oauth
  callback, gmail webhook (after fix #2/#3).
- pg_cron secrets via Supabase Vault (cp08 pattern) — verified in live
  `cron.job` bodies; no hardcoded keys in any of 17 jobs.

## Dependencies (npm audit, 11/06)

- Before: 18 vulnerabilities (9 moderate, 9 high). `npm audit fix` applied →
  **9 remain (3 moderate, 6 high)**, all in dev-time tool chains that don't
  ship to users or run in prod: `@vercel/node`'s bundled `undici@5` (local
  types/dev only — production functions run Vercel's own runtime) and the
  `shadcn` CLI dependency tree (`@modelcontextprotocol/sdk`, `fast-uri`,
  `minimatch`). `react-router` high CVE fixed by the bump to 7.17.0.
- Follow-up (P2): bump `@vercel/node` major / drop `shadcn` from devDeps at the
  next maintenance window.

## Accepted risks / open P2s (priority order)

1. Per-IP rate limiting on api/unsubscribe manual form (enumeration is already
   blocked; this is DoS hygiene).
2. click-redirect stored-link lookup (today: scheme-validated query param).
3. `pg_net` extension in public schema (Supabase-managed; advisor WARN).
4. Auth leaked-password protection off (magic-link login, single operator).
5. process-bounces trusts DSN content from the connected IMAP inbox (an
   attacker controlling the inbox could mass-suppress; inbox compromise is the
   bigger problem in that scenario).
6. Dev-chain npm vulns (above).
