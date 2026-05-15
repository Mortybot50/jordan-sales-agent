# scripts/

Operational scripts for the LeadFlow build. None of these run as part of the
Vite app — they're invoked by hand or via npm scripts.

## `smoke-api.sh` — API contract guard (v2)

Two-phase deploy guard:

- **Phase A** — Management API roster check. Reads
  `GET /v1/projects/{ref}/functions` and asserts every function is `ACTIVE`
  with the expected `verify_jwt` flag. **Zero HTTP calls to function
  handlers** — no risk of side effects (emails sent, drafts created, cron
  handlers fired). Closes Codex review v2 residuals on PR #46.
- **Phase B** — PostgREST + JWT contract check. Logs in as the demo user and
  hits the 7 tables the SPA reads. Read-only GETs only. Skipped with a
  clear note if any of `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` /
  `DEMO_EMAIL` / `DEMO_PASSWORD` is missing; Phase A still runs.

**Run:**

```bash
npm run smoke
# or
bash scripts/smoke-api.sh
```

**Required env / setup:**

Phase A:

| Var | Source |
|---|---|
| `SUPABASE_PROJECT_REF` | Optional. Falls back to `supabase/.temp/project-ref`. |
| `SUPABASE_ACCESS_TOKEN` | Optional. Falls back to macOS Keychain entries `Supabase CLI`/`supabase` (account `supabase`). `go-keyring-base64:` envelope is auto-decoded. If neither present, the script tells you the `security add-generic-password` command to provision it. |

Phase B (export or drop into `.env.local`):

| Var | Value |
|---|---|
| `VITE_SUPABASE_URL` | e.g. `https://bsevgxhnxlkzkcalevbb.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | anon JWT from Supabase dashboard |
| `DEMO_EMAIL` | demo user email |
| `DEMO_PASSWORD` | demo user password |

**What it checks:**

- Phase A: every function in `EXPECTED_JWT_TRUE` is `ACTIVE` with
  `verify_jwt=true`; every function in `EXPECTED_JWT_FALSE` is `ACTIVE` with
  `verify_jwt=false`; no unexpected functions present (drift).
- Phase B: login → 7 PostgREST GETs (`worker_runs`, `briefing_sends`,
  `route_days`, `deals`, `contacts`, `email_drafts`, `suppression_list`),
  each must return 200 + JSON array.

**Updating the truth table:** when a function is added, removed, or has its
`verify_jwt` flag flipped, edit `EXPECTED_JWT_TRUE` / `EXPECTED_JWT_FALSE` in
`scripts/smoke-api.sh`. The drift check will fail first deploy after the
change, prompting the update.

**Exit codes:** `0` = all checks passed (Phase B may have been skipped).
`1` = at least one assertion failed or the Management API returned non-200.
`2` = config gap (no project ref, no PAT, or Phase B login failed).

**When to run:** before every deploy + as part of post-deploy verification per
`~/.claude/rules/dev/frontend-smoke.md` §2.

## `classify-backlog.ts`

One-off Deno script for reply-intent backlog classification. Not part of the
deploy loop. Run manually when reprocessing historical inbound emails.
