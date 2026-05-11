-- Add service-role policy to oauth_state_nonces.
-- The table has RLS enabled but ZERO policies, meaning every operation through
-- the standard API is denied (service role bypasses via the rest layer, but
-- security advisors flag this as misconfiguration). We add an explicit policy
-- documenting the intent: only service role reads/writes.

create policy "service_role_full_access" on public.oauth_state_nonces
  for all
  to service_role
  using (true)
  with check (true);

comment on policy "service_role_full_access" on public.oauth_state_nonces is
  'OAuth nonces are short-lived server-side state. Only Edge Functions (service_role) should read/write. Browser/anon access is intentionally denied.';
