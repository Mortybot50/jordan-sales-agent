-- Add public_slug to users for the /book/:slug public booking page
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_slug TEXT UNIQUE;

-- Backfill existing users with slugified email prefix
UPDATE users
SET public_slug = lower(regexp_replace(split_part(email, '@', 1), '[^a-z0-9]+', '-', 'g'))
WHERE public_slug IS NULL AND email IS NOT NULL;

-- Public view exposing only safe columns for the booking page
-- anon role can SELECT this view; no auth required
-- Includes all users with a public_slug so the frontend can distinguish
-- "user not found" (404) from "user exists but no calendly_url" (unavailable).
CREATE OR REPLACE VIEW public_user_profiles AS
  SELECT public_slug, calendly_url, full_name, email
  FROM users
  WHERE public_slug IS NOT NULL;

GRANT SELECT ON public_user_profiles TO anon;
