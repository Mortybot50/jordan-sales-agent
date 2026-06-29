-- Reactivates image logos in Jordan's cold-outreach signature (the follow-up
-- PR anticipated by 20260609094818_email_signature_density.sql).
--
-- DRIFT NOTE (discovered live 29/06/2026 — read before editing):
--   1. OWNER: the density migration (20260609094818) and this PR's first draft
--      targeted user_id 3b31e455 (the old demo id). But jordan_login_migration
--      (20260612083918, line 60) already transferred email_signature_templates
--      ownership demo(3b31e455) -> jordan(027c0c4a). The LIVE rows are owned by
--      027c0c4a, so we scope to that. On a fresh replay this migration still
--      runs AFTER the login migration (timestamp 20260629 > 20260612), so the
--      rows are at 027c0c4a in every ordering.
--   2. body_text: the density migration NEVER applied to remote — body_text
--      still carries the literal "[Culligan 90 Years logo]" placeholder, which
--      is what the text/plain part of every send shows today. A signature whose
--      text fallback is broken is not shippable, so this migration also lands
--      the density body_text fix (drop the placeholder -> text fallback
--      "Culligan Group · Purezza Premium Water", compact licence line). The
--      standalone density migration becomes a no-op against remote (its
--      3b31e455 WHERE matches nothing) and is harmless on fresh replay.
--
-- What this does (per brand_key, both rows carry all three logos):
--   body_html — replaces the text logo line with a horizontal row of THREE
--     brand logos (Culligan, then Purezza, then Zip — Jordan's locked order)
--     served from the public signature-assets bucket. Logos used as-sent
--     (solid backgrounds, no transparency stripping). Explicit width/height at
--     40px tall: Culligan 1280x720->71x40, Purezza 160x160->40x40,
--     Zip 175x74->95x40.
--   body_text — density-correct plaintext fallback (no image refs).
--
-- Preserved verbatim from the density spec: name/title/brand block,
-- {{sending_mailbox_email}} line, full licence numbers, BOTH disclaimer
-- paragraphs, density styling (name block line-height 1.3, disclaimers 9px/1.3).
-- Purezza brand line = "Purezza Australia"; culligan_zip = "Culligan Group".
--
-- Idempotent: WHERE skips rows whose body_html already references the Culligan
-- logo asset, so a re-run is a no-op. The guard is written
-- (body_html IS NULL OR body_html NOT LIKE '%logo-culligan.jpg%') because a bare
-- NOT LIKE evaluates to NULL (not TRUE) on a NULL body_html, which would skip
-- fresh-replay rows seeded without an HTML signature and leave the body_text
-- placeholder unfixed.

DO $$
DECLARE
  v_base          text := 'https://bsevgxhnxlkzkcalevbb.supabase.co/storage/v1/object/public/signature-assets';
  v_logo_row      text;
  v_html_purezza  text;
  v_html_culligan text;
  v_text_purezza  text;
  v_text_culligan text;
BEGIN
  -- Three-logo row (Culligan → Purezza → Zip). Replaces the old text line.
  v_logo_row := concat(
    '<p style="margin:12px 0;">',
    '<img src="', v_base, '/logo-culligan.jpg" width="71" height="40" alt="Culligan" style="vertical-align:middle;margin-right:10px;border:0;" />',
    '<img src="', v_base, '/logo-purezza.jpg" width="40" height="40" alt="Purezza Premium Water" style="vertical-align:middle;margin-right:10px;border:0;" />',
    '<img src="', v_base, '/logo-zip.jpg" width="95" height="40" alt="Zip Water" style="vertical-align:middle;border:0;" />',
    '</p>'
  );

  -- HTML body — Purezza row (brand line: "Purezza Australia").
  v_html_purezza := concat(
    '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.3;color:#1f2937;"><strong>Jordan Marziale</strong><br/>Business Development Manager<br/>Purezza Australia<br/>Mobile: +61 409 355 713<br/>{{sending_mailbox_email}}</p>',
    E'\n',
    v_logo_row,
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;">WA PL5415 · QLD 15137160 · NSW 291745C · SA PGE284004</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">Information contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">E-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.</p>'
  );

  -- HTML body — Culligan Zip row (brand line: "Culligan Group").
  v_html_culligan := concat(
    '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.3;color:#1f2937;"><strong>Jordan Marziale</strong><br/>Business Development Manager<br/>Culligan Group<br/>Mobile: +61 409 355 713<br/>{{sending_mailbox_email}}</p>',
    E'\n',
    v_logo_row,
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;">WA PL5415 · QLD 15137160 · NSW 291745C · SA PGE284004</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">Information contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">E-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.</p>'
  );

  -- Plaintext fallback — Purezza row (density-correct, no image refs).
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

  -- Plaintext fallback — Culligan Zip row.
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

  UPDATE public.email_signature_templates
  SET    body_html  = v_html_purezza,
         body_text  = v_text_purezza,
         updated_at = now()
  WHERE  user_id    = '027c0c4a-ea67-46ef-82ef-47fbd5d1df65'::uuid
    AND  org_id     = '5557189e-5c2d-4990-afad-6aa1861826cd'::uuid
    AND  brand_key  = 'purezza'
    AND  (body_html IS NULL OR body_html NOT LIKE '%signature-assets/logo-culligan.jpg%');

  UPDATE public.email_signature_templates
  SET    body_html  = v_html_culligan,
         body_text  = v_text_culligan,
         updated_at = now()
  WHERE  user_id    = '027c0c4a-ea67-46ef-82ef-47fbd5d1df65'::uuid
    AND  org_id     = '5557189e-5c2d-4990-afad-6aa1861826cd'::uuid
    AND  brand_key  = 'culligan_zip'
    AND  (body_html IS NULL OR body_html NOT LIKE '%signature-assets/logo-culligan.jpg%');
END $$;
