-- =============================================================================
-- Function EXECUTE lockdown + search_path pinning
-- Migration: 20260611071849_function_execute_lockdown
-- =============================================================================
-- Supabase security advisors (11/06/2026) flagged every SECURITY DEFINER
-- function in public as executable by anon/authenticated via
-- /rest/v1/rpc/<fn>. Worst case: claim_send_queue_batch lets an
-- unauthenticated caller claim AND read queued outbound emails.
--
-- Verified before writing this migration: the only .rpc() call sites in the
-- codebase run under service-role clients (api/route/generate-day.ts uses
-- ctx.admin; drain-send-queue + send-via-smtp Edge Functions use the
-- service-role client). No frontend RPC usage exists.
--
-- Carve-out: auth_org_id() is referenced inside RLS policy expressions, which
-- execute with the privileges of the querying role — authenticated MUST keep
-- EXECUTE on it. Only anon loses it (no anon table access exists).
--
-- custom_access_token_hook keeps its supabase_auth_admin grant (Auth service
-- calls it); anon/authenticated/public are revoked per Supabase docs.
-- =============================================================================

-- Default-deny going forward: new functions don't auto-grant to public.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- 1. RPC-exposed SECURITY DEFINER functions — service-role only.
revoke execute on function public.claim_send_queue_batch(integer) from public, anon, authenticated;
revoke execute on function public.compute_inbox_reputation(uuid) from public, anon, authenticated;
revoke execute on function public.compute_lead_score(uuid) from public, anon, authenticated;
revoke execute on function public.generate_route_stops(uuid, integer) from public, anon, authenticated;
revoke execute on function public.is_suppressed(uuid, text) from public, anon, authenticated;
revoke execute on function public.leadflow_drain_crawl_queue() from public, anon, authenticated;
revoke execute on function public.select_next_sender(uuid) from public, anon, authenticated;

-- 2. Trigger / hook functions — never legitimately called via RPC.
--    (Trigger firing does not require the DML role to hold EXECUTE.)
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.email_drafts_suppression_guard() from public, anon, authenticated;
revoke execute on function public.handle_field_visit_insert() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.normalise_suppression_email() from public, anon, authenticated;
revoke execute on function public.trigger_recompute_lead_score() from public, anon, authenticated;

-- 3. RLS-policy helper — authenticated keeps EXECUTE (policies need it),
--    anon does not.
revoke execute on function public.auth_org_id() from public, anon;
grant execute on function public.auth_org_id() to authenticated;

-- 4. Pin search_path on the eight functions the advisor flagged as mutable.
--    'public' (not '') because the bodies use unqualified table names.
alter function public.haversine_km(double precision, double precision, double precision, double precision) set search_path = 'public';
alter function public.set_updated_at() set search_path = 'public';
alter function public.compute_deal_financials() set search_path = 'public';
alter function public.sync_close_won_at() set search_path = 'public';
alter function public.recompute_monthly_gate(uuid, uuid, date) set search_path = 'public';
alter function public.trg_deals_recompute_gate_fn() set search_path = 'public';
alter function public.run_monthly_gate_forfeits() set search_path = 'public';
alter function public.touch_claude_conversation_updated_at() set search_path = 'public';
