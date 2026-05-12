# scripts/

Operational scripts for the LeadFlow build. None of these run as part of the
Vite app — they're invoked by hand or via npm scripts.

## `smoke-api.sh` — API contract guard

Verifies the deployed Supabase REST + Edge Function surface returns the
response shapes the SPA depends on. Catches API/frontend contract drift
between Vercel and Supabase Edge deploys before it ships.

**Run:**

```bash
npm run smoke
# or
bash scripts/smoke-api.sh
```

**Required env (export or drop into `.env.local`):**

| Var | Value |
|---|---|
| `VITE_SUPABASE_URL` | e.g. `https://bsevgxhnxlkzkcalevbb.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon JWT from Supabase dashboard |
| `DEMO_EMAIL` | demo user email (PostgREST + JWT login) |
| `DEMO_PASSWORD` | demo user password |

**What it checks:**

- Login as demo user → JWT mint
- 7 PostgREST GETs against the tables the SPA reads (`worker_runs`,
  `briefing_sends`, `route_days`, `deals`, `contacts`, `email_drafts`,
  `suppression_list`) — each must return a 200 + JSON array.
- 11 Edge Function unauthed POSTs → each must return 401/403 (proves the
  function is deployed and `verify_jwt` is on).
- Authed `generate-draft` with empty body → must return 400/404/503 (validates
  input without firing the LLM).

**Exit codes:** `0` = all checks passed. `1` = at least one endpoint failed.
`2` = login failed (couldn't get a JWT — usually wrong creds or wrong URL).

**When to run:** before every deploy + as part of post-deploy verification per
`~/.claude/rules/dev/frontend-smoke.md` §2.

## `classify-backlog.ts`

One-off Deno script for reply-intent backlog classification. Not part of the
deploy loop. Run manually when reprocessing historical inbound emails.
