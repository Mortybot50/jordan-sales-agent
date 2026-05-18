-- =============================================================================
-- Lock down public.get_email_account_smtp(uuid) to service_role only.
-- Migration: 20260519000002_revoke_get_email_account_smtp_public
-- =============================================================================
-- Rationale: Supabase grants EXECUTE on functions to PUBLIC by default. As a
-- SECURITY DEFINER function this helper returns smtp_password_encrypted and
-- other SMTP config — which is useless without TOKEN_ENCRYPTION_KEY, but
-- defence-in-depth says don't even expose the ciphertext to anon callers.
-- Restrict EXECUTE to service_role only; the send-via-smtp Edge Function
-- already uses the service_role key.
-- =============================================================================

revoke execute on function public.get_email_account_smtp(uuid) from public;
revoke execute on function public.get_email_account_smtp(uuid) from anon;
revoke execute on function public.get_email_account_smtp(uuid) from authenticated;
grant  execute on function public.get_email_account_smtp(uuid) to service_role;
