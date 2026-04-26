-- Security patches: S1 (Calendly tenant scoping) + S3 (OAuth state HMAC + nonce)
--
-- S1: Add users.calendly_account_email to map a Calendly webhook payload's
--     invitee.tracking calendar account back to a specific user/org. Without
--     this, the webhook handler had to ilike() across all orgs (cross-tenant
--     write surface). With it, we scope contact lookups to user.org_id.
--
-- S3: Add oauth_state_nonces to back the HMAC + single-use nonce flow that
--     replaces the plaintext user_id state parameter on /api/oauth/gmail/start.

-- S1
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS calendly_account_email text;

-- Lowercase + unique (nullable) — Calendly emails normalised on write
CREATE UNIQUE INDEX IF NOT EXISTS users_calendly_account_email_unique_idx
  ON public.users (lower(calendly_account_email))
  WHERE calendly_account_email IS NOT NULL;

-- S3
CREATE TABLE IF NOT EXISTS public.oauth_state_nonces (
  nonce       text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '10 minutes')
);

CREATE INDEX IF NOT EXISTS oauth_state_nonces_expires_at_idx
  ON public.oauth_state_nonces (expires_at);

-- Service role only — these rows are written/read by the OAuth API routes
-- using SUPABASE_SERVICE_ROLE_KEY, never by end users.
ALTER TABLE public.oauth_state_nonces ENABLE ROW LEVEL SECURITY;

-- No policies => all access is denied for anon/authenticated. Service role
-- bypasses RLS by default. This is intentional.
