-- Adds the parallel HTML body columns so the styled signature (with image
-- logos) can travel end-to-end alongside the canonical text/plain body.
--
-- Scope note (follow-up to 20260609094818_email_signature_density.sql):
--   That migration documented body_html as DEAD-LETTER metadata because the
--   outbound pipeline transmitted text only. This PR reactivates body_html. To
--   carry it through, drafts and the send queue each need a nullable HTML body:
--     email_drafts.body_html          — Claude body + signature HTML + unsub HTML
--     email_drafts.edited_body_html   — user override (parallels edited_body)
--     email_send_queue.body_html      — what drain-send-queue sends as text/html
--
-- All columns are nullable. When body_html is NULL the pipeline falls back to
-- textToHtml(body_text), so existing text-only drafts keep working unchanged.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS — safe to re-run.

ALTER TABLE public.email_drafts
  ADD COLUMN IF NOT EXISTS body_html        text,
  ADD COLUMN IF NOT EXISTS edited_body_html text;

ALTER TABLE public.email_send_queue
  ADD COLUMN IF NOT EXISTS body_html text;
