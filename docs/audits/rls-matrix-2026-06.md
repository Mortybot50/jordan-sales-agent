# RLS Matrix — 2026-06-11

> Source: live `pg_policies` + `pg_class.relrowsecurity` on project `bsevgxhnxlkzkcalevbb`,
> queried 11/06/2026 via Supabase MCP. 50 tables in `public`.
>
> **Verdict: every table has RLS enabled. No gaps requiring migrations.**
> Missing commands in the matrix are deny-by-default (no policy = no access),
> which is intentional for append-only / system-written tables.
> Companion hardening applied the same day: `20260611071849_function_execute_lockdown`
> (anon/authenticated EXECUTE revoked on all SECURITY DEFINER RPCs; search_path pinned).

Legend: ✓ = policy exists for that command. org = qual references `org_id`/`auth_org_id()`.
user = qual references `auth.uid()`/`user_id`. svc = service-role-only. ref = shared
reference data (read-only for authenticated by design).

| Table | RLS | Policies | SEL | INS | UPD | DEL | Scoping | Notes |
|---|---|---|---|---|---|---|---|---|
| activities | ✓ | 2 | ✓ | ✓ | — | — | org | append-only by design |
| auto_sourced_candidates | ✓ | 2 | ✓ | — | ✓ | — | org | inserts via service role (sourcing) |
| briefing_sends | ✓ | 1 | ✓ | — | — | — | user | written by cron (service role) |
| calendly_events | ✓ | 1 | ✓ | — | — | — | org | written by webhook (service role) |
| claude_conversations | ✓ | 5 | ✓ | ✓ | ✓ | ✓ | org+user | |
| claude_messages | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org+user | |
| contact_tags | ✓ | 3 | ✓ | ✓ | — | ✓ | org | |
| contacts | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org | |
| deals | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org | |
| draft_edits | ✓ | 2 | ✓ | ✓ | — | — | org | learning-loop log, append-only |
| email_accounts | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org+user | SMTP secret column revoked separately (20260519) |
| email_drafts | ✓ | 2 | ✓ | — | ✓ | — | org | inserts via generate-draft EF (service role) |
| email_pixel_hits | ✓ | 2 | ✓ | ✓ | — | — | org | |
| email_send_events | ✓ | 2 | ✓ | ✓ | — | — | org | |
| email_send_queue | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org | claim path via SECURITY DEFINER fn, now svc-only |
| email_signature_templates | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org+user | |
| field_visits | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org+user | |
| gmail_connections | ✓ | 1 | ✓ | ✓ | ✓ | ✓ | user | tokens AES-encrypted at rest |
| inbox_placement_seeds | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org+user | |
| lead_scores | ✓ | 1 | ✓ | — | — | — | org | trigger-written |
| lead_search_runs | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org | |
| lead_searches | ✓ | 5 | ✓ | ✓ | ✓ | ✓ | org | |
| learning_digests | ✓ | 2 | ✓ | — | ✓ | — | user | cron-written |
| monthly_gates | ✓ | 3 | ✓ | ✓ | ✓ | — | org | |
| notification_log | ✓ | 2 | ✓ | ✓ | ✓ | ✓ | org+user | |
| oauth_state_nonces | ✓ | 1 | svc | svc | svc | svc | svc | service-role-only by design (CSRF nonces) |
| orgs | ✓ | 2 | ✓ | — | ✓ | — | org | |
| pipeline_stages | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org | |
| postmaster_grades | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org+user | |
| products | ✓ | 1 | ✓ | — | — | — | ref | shared catalogue, read-only |
| reopening_events | ✓ | 3 | ✓ | ✓ | ✓ | — | org | |
| reply_scan_runs | ✓ | 1 | ✓ | — | — | — | org+user | cron observability log |
| route_days | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org+user | |
| route_stops | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org+user | |
| sending_domains | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | user | |
| sequence_enrollments | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org+user | |
| sequence_steps | ✓ | 5 | ✓ | ✓ | ✓ | ✓ | org+user | |
| sequences | ✓ | 5 | ✓ | ✓ | ✓ | ✓ | org+user | |
| signals | ✓ | 2 | ✓ | — | ✓ | — | org | service-role inserts |
| suppression_list | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org | |
| tasks | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org | |
| users | ✓ | 2 | ✓ | — | ✓ | — | org+user | created by auth trigger |
| vcglr_licences | ✓ | 2 | ✓ | svc | svc | svc | ref | VIC licence registry, authed read / svc write |
| vcglr_signals | ✓ | 2 | ✓ | svc | svc | svc | ref | same pattern |
| venue_groups | ✓ | 5 | ✓ | ✓ | ✓ | ✓ | org | |
| venue_observations | ✓ | 2 | ✓ | ✓ | — | — | org | |
| venues | ✓ | 4 | ✓ | ✓ | ✓ | ✓ | org | |
| warmup_messages | ✓ | 2 | ✓ | deny | deny | deny | ref | authed read, writes denied (qual=false) |
| warmup_threads | ✓ | 2 | ✓ | ✓ | ✓ | ✓ | org | |
| worker_runs | ✓ | 2 | ✓ | — | — | — | org+user | cron observability |

## Unscoped tables — verified intentional

| Table | Why it's fine |
|---|---|
| oauth_state_nonces | Single `service_role_full_access` policy; anon/authenticated have zero access |
| products | Read-only shared catalogue (`products_read_all`, SELECT only) |
| vcglr_licences / vcglr_signals | Public VIC licence registry data; write policies require `auth.role() = 'service_role'` |
| warmup_messages | `warmup_messages_no_writes` (qual `false`) denies all writes; read needs authenticated |

## Advisor follow-ups closed the same day

- `anon_security_definer_function_executable` (12 functions) + `authenticated_…` (12) —
  fixed by `20260611071849_function_execute_lockdown`. Verified post-apply:
  `claim_send_queue_batch` / `is_suppressed` return `42501 permission denied` for anon;
  `service_role` retains EXECUTE on all; `authenticated` retains only `auth_org_id()`
  (required by RLS policy expressions).
- `function_search_path_mutable` (8 functions) — pinned `search_path = 'public'` in the
  same migration.
- Remaining WARNs (accepted, logged): `pg_net` extension in public schema (Supabase-managed,
  used by pg_cron HTTP calls); leaked-password protection off (magic-link login, single
  user — enable when password auth becomes primary).
