# scripts/

Operational scripts for the LeadFlow build. None of these run as part of the
Vite app — they're invoked by hand or via npm scripts.

## `smoke-api.sh` — Edge Function deploy guard (v2)

Reads the live Edge Function roster from the Supabase Management API
(`GET /v1/projects/{ref}/functions`) and asserts every function is `ACTIVE`
with the expected `verify_jwt` flag. **Zero HTTP calls to function handlers**
— no risk of triggering side effects (emails sent, drafts created, cron
handlers fired). Closes Codex review v2 residuals on PR #46.

**Run:**

```bash
npm run smoke
# or
bash scripts/smoke-api.sh
```

**Required env / setup:**

| Var | Source |
|---|---|
| `SUPABASE_PROJECT_REF` | Optional. Falls back to `supabase/.temp/project-ref`. |
| `SUPABASE_ACCESS_TOKEN` | Optional. Falls back to macOS Keychain entries `Supabase CLI`/`supabase` (account `supabase`). `go-keyring-base64:` envelope is auto-decoded. If neither present, the script tells you the `security add-generic-password` command to provision it. |

**What it checks:**

- Every function in `EXPECTED_JWT_TRUE` is `ACTIVE` with `verify_jwt=true`.
- Every function in `EXPECTED_JWT_FALSE` is `ACTIVE` with `verify_jwt=false`.
- Drift detection: any deployed function not in either roster fails the smoke.

**Updating the truth table:** when a function is added, removed, or has its
`verify_jwt` flag flipped, edit `EXPECTED_JWT_TRUE` / `EXPECTED_JWT_FALSE` in
`scripts/smoke-api.sh`. The drift check will fail first deploy after the
change, prompting the update.

**Exit codes:** `0` = all checks passed. `1` = at least one assertion failed
or the Management API returned non-200. `2` = config gap (no project ref or
no PAT).

**When to run:** before every deploy + as part of post-deploy verification per
`~/.claude/rules/dev/frontend-smoke.md` §2.

## `classify-backlog.ts`

One-off Deno script for reply-intent backlog classification. Not part of the
deploy loop. Run manually when reprocessing historical inbound emails.
