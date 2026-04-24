-- Add user-configurable voice/style rules column.
-- Injected into the generate-draft Edge Function system prompt so users can
-- override Jordan's default voice (e.g. forbid specific times, cap word count).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS voice_rules TEXT;
