-- Per-brand email signatures (FE-PO-07)
--
-- Stores Jordan's signature templates keyed by (user_id, brand_key) so the
-- generate-draft / sequence-tick workers can resolve the right signature
-- based on `deals.product_id → products.brand`. The `{{sending_mailbox_email}}`
-- placeholder is substituted at draft time with the email_address of the
-- inbox actually sending the message (per Jordan's Option B — From / Reply-To
-- / signature email line all match).
--
-- brand_key:
--   'purezza'       → Purezza Australia signature
--   'culligan_zip'  → Culligan Group signature (covers Culligan + Zip + Birko)
--
-- Logos are text placeholders for now — Jordan will send PNG files later.
-- Swap procedure: upload PNGs to a Supabase Storage bucket and replace the
-- `[Culligan 90 Years logo] | [PUREZZA PREMIUM WATER logo]` token with
-- <img> tags in body_html.

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_signature_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.orgs(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  brand_key   text NOT NULL CHECK (brand_key IN ('purezza', 'culligan_zip')),
  body_html   text NOT NULL,
  body_text   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, brand_key)
);

CREATE INDEX IF NOT EXISTS email_signature_templates_org_idx
  ON public.email_signature_templates (org_id);

CREATE TRIGGER set_email_signature_templates_updated_at
  BEFORE UPDATE ON public.email_signature_templates
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

ALTER TABLE public.email_signature_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_signature_templates_select" ON public.email_signature_templates
  FOR SELECT USING (org_id = public.auth_org_id());

CREATE POLICY "email_signature_templates_insert" ON public.email_signature_templates
  FOR INSERT WITH CHECK (org_id = public.auth_org_id() AND user_id = auth.uid());

CREATE POLICY "email_signature_templates_update" ON public.email_signature_templates
  FOR UPDATE USING (org_id = public.auth_org_id() AND user_id = auth.uid())
  WITH CHECK (org_id = public.auth_org_id() AND user_id = auth.uid());

CREATE POLICY "email_signature_templates_delete" ON public.email_signature_templates
  FOR DELETE USING (org_id = public.auth_org_id() AND user_id = auth.uid());

-- Seed both templates for the demo user (Jordan).
-- user_id = 3b31e455-92c7-4507-8b4b-0e274c27009c
-- org_id  = 5557189e-5c2d-4990-afad-6aa1861826cd
INSERT INTO public.email_signature_templates (org_id, user_id, brand_key, body_text, body_html)
VALUES (
  '5557189e-5c2d-4990-afad-6aa1861826cd'::uuid,
  '3b31e455-92c7-4507-8b4b-0e274c27009c'::uuid,
  'purezza',
  E'Jordan Marziale\nBusiness Development Manager\nPurezza Australia\nMobile: +61 409 355 713\n{{sending_mailbox_email}}\n\n[Culligan 90 Years logo] | [PUREZZA PREMIUM WATER logo]\n\nWA Lic number PL5415, QLD Lic number 15137160, NSW Lic number 291745C, SA Lic number PGE284004\n\nInformation contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.\n\nE-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.',
  E'<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#1f2937;"><strong>Jordan Marziale</strong><br/>Business Development Manager<br/>Purezza Australia<br/>Mobile: +61 409 355 713<br/>{{sending_mailbox_email}}</p>\n<p style="margin:12px 0;font-family:Arial,sans-serif;font-size:12px;color:#64748b;">[Culligan 90 Years logo] | [PUREZZA PREMIUM WATER logo]</p>\n<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:11px;color:#64748b;">WA Lic number PL5415, QLD Lic number 15137160, NSW Lic number 291745C, SA Lic number PGE284004</p>\n<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;line-height:1.4;">Information contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.</p>\n<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;line-height:1.4;">E-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.</p>'
)
ON CONFLICT (user_id, brand_key) DO NOTHING;

INSERT INTO public.email_signature_templates (org_id, user_id, brand_key, body_text, body_html)
VALUES (
  '5557189e-5c2d-4990-afad-6aa1861826cd'::uuid,
  '3b31e455-92c7-4507-8b4b-0e274c27009c'::uuid,
  'culligan_zip',
  E'Jordan Marziale\nBusiness Development Manager\nCulligan Group\nMobile: +61 409 355 713\n{{sending_mailbox_email}}\n\n[Culligan 90 Years logo] | [PUREZZA PREMIUM WATER logo]\n\nWA Lic number PL5415, QLD Lic number 15137160, NSW Lic number 291745C, SA Lic number PGE284004\n\nInformation contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.\n\nE-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.',
  E'<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;color:#1f2937;"><strong>Jordan Marziale</strong><br/>Business Development Manager<br/>Culligan Group<br/>Mobile: +61 409 355 713<br/>{{sending_mailbox_email}}</p>\n<p style="margin:12px 0;font-family:Arial,sans-serif;font-size:12px;color:#64748b;">[Culligan 90 Years logo] | [PUREZZA PREMIUM WATER logo]</p>\n<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:11px;color:#64748b;">WA Lic number PL5415, QLD Lic number 15137160, NSW Lic number 291745C, SA Lic number PGE284004</p>\n<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;line-height:1.4;">Information contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.</p>\n<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;line-height:1.4;">E-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.</p>'
)
ON CONFLICT (user_id, brand_key) DO NOTHING;

COMMIT;
