-- Tightens the cold-outreach email signature per Jordan's 09/06/2026 feedback.
--
-- Scope note (post-Codex round 1 on PR #100):
--   `email_signature_templates.body_html` is currently DEAD-LETTER metadata.
--   The outbound pipeline reads only `body_text`:
--     generate-draft/index.ts:80-82      → .select('body_text')
--     sequence-tick/index.ts:142-147     → .select('body_text')
--     drain-send-queue/index.ts:243-244  → textToHtml(bodyText) — escapes all HTML
--   So any <img> tags placed in body_html would never reach a recipient. Per
--   Morty's 09/06/2026 call (Option A), this PR cleans body_text only; a
--   follow-up PR will add body_html into email_drafts + email_send_queue and
--   reactivate styled signatures + image logos end-to-end.
--
-- What this migration does:
--   1. body_text — drop the literal "[Culligan 90 Years logo] | [PUREZZA
--      PREMIUM WATER logo]" placeholder Jordan flagged. Replace with the
--      text fallback "Culligan Group · Purezza Premium Water".
--   2. body_text — compact licence line to "WA PL5415 · QLD 15137160 · NSW
--      291745C · SA PGE284004" (was: "WA Lic number PL5415, QLD Lic number
--      15137160, ...").
--   3. body_html — keep in sync with the new body_text shape (text-only
--      layout, no <img> tags, no Vercel URLs). Still parameterised HTML so
--      when the follow-up PR wires body_html through the send path, the
--      density is already correct.
--   4. body_html — line-height drops from 1.5 → 1.3 on the name block;
--      disclaimer paragraphs from 10px/1.4 → 9px/1.3 so they no longer
--      compete visually with the message body.
--
-- Content (full licence numbers, full Culligan confidentiality + virus
-- disclaimer) is preserved verbatim per Morty's contractually-locked
-- decision — every outbound carries the full block.
--
-- Idempotent: the WHERE clause checks for the literal logo placeholder
-- before updating, so a re-run is a no-op.

DO $$
DECLARE
  v_html_purezza      text;
  v_html_culligan     text;
  v_text_purezza      text;
  v_text_culligan     text;
BEGIN
  -- New HTML body — Purezza row (brand line: "Purezza Australia").
  -- Text-only logo line (no <img> tags) until the pipeline rebuild PR.
  v_html_purezza := concat(
    '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.3;color:#1f2937;"><strong>Jordan Marziale</strong><br/>Business Development Manager<br/>Purezza Australia<br/>Mobile: +61 409 355 713<br/>{{sending_mailbox_email}}</p>',
    E'\n',
    '<p style="margin:12px 0;font-family:Arial,sans-serif;font-size:12px;color:#64748b;">Culligan Group · Purezza Premium Water</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;">WA PL5415 · QLD 15137160 · NSW 291745C · SA PGE284004</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">Information contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">E-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.</p>'
  );

  -- New HTML body — Culligan Zip row (brand line: "Culligan Group").
  v_html_culligan := concat(
    '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.3;color:#1f2937;"><strong>Jordan Marziale</strong><br/>Business Development Manager<br/>Culligan Group<br/>Mobile: +61 409 355 713<br/>{{sending_mailbox_email}}</p>',
    E'\n',
    '<p style="margin:12px 0;font-family:Arial,sans-serif;font-size:12px;color:#64748b;">Culligan Group · Purezza Premium Water</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;">WA PL5415 · QLD 15137160 · NSW 291745C · SA PGE284004</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">Information contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">E-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.</p>'
  );

  -- New plaintext body — Purezza row. This is what actually goes out today.
  v_text_purezza := concat(
    'Jordan Marziale', E'\n',
    'Business Development Manager', E'\n',
    'Purezza Australia', E'\n',
    'Mobile: +61 409 355 713', E'\n',
    '{{sending_mailbox_email}}', E'\n\n',
    'Culligan Group · Purezza Premium Water', E'\n\n',
    'WA PL5415 · QLD 15137160 · NSW 291745C · SA PGE284004', E'\n\n',
    'Information contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.', E'\n\n',
    'E-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.'
  );

  -- New plaintext body — Culligan Zip row.
  v_text_culligan := concat(
    'Jordan Marziale', E'\n',
    'Business Development Manager', E'\n',
    'Culligan Group', E'\n',
    'Mobile: +61 409 355 713', E'\n',
    '{{sending_mailbox_email}}', E'\n\n',
    'Culligan Group · Purezza Premium Water', E'\n\n',
    'WA PL5415 · QLD 15137160 · NSW 291745C · SA PGE284004', E'\n\n',
    'Information contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.', E'\n\n',
    'E-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.'
  );

  -- Scope to Jordan's user_id + org_id (per Codex round 2 [P1]). The
  -- replacement copy is Jordan's identity (name, phone, brand line) so we
  -- must NOT touch any other user's signature row even if they happen to
  -- share the placeholder text. user_id + org_id are the same values seeded
  -- in 20260526120000_email_signature_templates.sql.
  --
  -- Idempotency guard: check body_text (NOT body_html) because the outbound
  -- pipeline reads only body_text — if the two fields ever diverge (e.g. a
  -- future hand-edit to body_html alone), we still need to catch the rows
  -- whose plaintext placeholder is still going out to recipients. Per Codex
  -- round 3 [P2].
  UPDATE public.email_signature_templates
  SET    body_html  = v_html_purezza,
         body_text  = v_text_purezza,
         updated_at = now()
  WHERE  user_id    = '3b31e455-92c7-4507-8b4b-0e274c27009c'::uuid
    AND  org_id     = '5557189e-5c2d-4990-afad-6aa1861826cd'::uuid
    AND  brand_key  = 'purezza'
    AND  body_text LIKE '%[Culligan 90 Years logo]%';

  UPDATE public.email_signature_templates
  SET    body_html  = v_html_culligan,
         body_text  = v_text_culligan,
         updated_at = now()
  WHERE  user_id    = '3b31e455-92c7-4507-8b4b-0e274c27009c'::uuid
    AND  org_id     = '5557189e-5c2d-4990-afad-6aa1861826cd'::uuid
    AND  brand_key  = 'culligan_zip'
    AND  body_text LIKE '%[Culligan 90 Years logo]%';
END $$;
