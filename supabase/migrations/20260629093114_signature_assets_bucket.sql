-- Public storage bucket for email-signature brand logos (Culligan, Purezza,
-- Zip). Logos are embedded as <img src="…/storage/v1/object/public/…"> in the
-- signature HTML, so they must be reachable without auth by any recipient's
-- email client. A public bucket serves objects via /object/public/<bucket>/<file>
-- with no RLS check.
--
-- Uploads are done by the service role (which bypasses RLS), so no insert/update
-- policy is required. We deliberately do NOT add anon write policies — only the
-- backend mutates this bucket.
--
-- Idempotent: ON CONFLICT (id) DO UPDATE keeps public=true even if a prior
-- private bucket of the same id exists.

insert into storage.buckets (id, name, public)
values ('signature-assets', 'signature-assets', true)
on conflict (id) do update set public = true;
