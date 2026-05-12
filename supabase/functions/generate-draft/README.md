# generate-draft Edge Function

Generates a Claude-authored draft email for a contact and stores it in
`email_drafts` for Jordan's review. Honours per-org suppression list,
do-not-contact flags, and the cold-outreach prior-activity guard.

## Required environment variables

| Var | Purpose | Status if missing |
|---|---|---|
| `ANTHROPIC_API_KEY` | Calls Claude to author the draft body | 503 with `error: "Anthropic API key not configured — ask admin."` |
| `SUPABASE_URL` | Service-role client target | Function fails to boot |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role auth for inserts | Function fails to boot |
| `SUPABASE_ANON_KEY` | Verifies the caller's JWT | Caller-auth path 500s |
| `UNSUBSCRIBE_SIGNING_KEY` | **MANDATORY.** HMAC key for the per-recipient unsubscribe token baked into the footer. **Must be ≥32 chars** (recommended: 64-char hex from `openssl rand -hex 32`). | **503 with `code: "UNSUB_KEY_MISSING"`. The function refuses to draft any email.** |
| `PUBLIC_APP_URL` | Base URL for the unsubscribe link in the footer | Falls back to `https://jordan-sales-agent.vercel.app` |

## Minting `UNSUBSCRIBE_SIGNING_KEY`

```bash
openssl rand -hex 32
# → 64-char hex string, e.g. 3f8b1c9d2e7a5f4b6c8d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b
```

Set it on the function:

- Supabase dashboard → Project → Edge Functions → Secrets → `UNSUBSCRIBE_SIGNING_KEY`
- Or CLI: `supabase secrets set UNSUBSCRIBE_SIGNING_KEY=<value> --project-ref bsevgxhnxlkzkcalevbb`

The same key must be available to `api/unsubscribe.ts` (the Node-side verify
path on Vercel) — set it there too, or token verification fails.

## Why the hard-fail (BE-P0-03)

Spam Act 2003 (Cth) s.18 mandates a functional unsubscribe on every commercial
electronic message. Civil penalty up to ~$222,000 per day under s.24.

Before BE-P0-03 the function ran `if (signingKey) { ...append footer... }`,
silently dropping the footer when the env var was absent. That ships
non-compliant cold email. The current code calls `checkUnsubKey` at the top
of every request and returns 503 if the key is absent or shorter than 32
chars. See `_unsub-key.ts` for the pure helper + unit tests at
`tests/unsub-key.test.mts`.

## Response codes

| Status | When |
|---|---|
| 200 | Draft generated and stored. Body: `{ draft: { id, subject, body, ... } }` |
| 400 | `contact_id` or `draft_type` missing from the request body |
| 401 | Missing or invalid Authorization header |
| 403 | Caller's `org_id` doesn't match the contact's `org_id` |
| 404 | Contact not found, or caller has no profile row |
| 409 | Email is on suppression list, OR `draft_type=cold_outreach` but the contact already has prior activity |
| 500 | Anthropic API call or Postgres insert failed (check logs) |
| 503 | `ANTHROPIC_API_KEY` or `UNSUBSCRIBE_SIGNING_KEY` not configured |
