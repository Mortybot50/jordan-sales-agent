-- Tightens the cold-outreach email signature per Jordan's 09/06/2026 feedback:
--   1. line-height on the name/title/brand block drops from 1.5 → 1.3
--   2. logo placeholders ([Culligan 90 Years logo] | [PUREZZA PREMIUM WATER logo])
--      are replaced with real <img> tags pointing at /email-assets/ on Vercel.
--      Culligan ships as SVG (source-only format on culligan.com.au); Purezza
--      ships as PNG (converted from the source .webp via macOS `sips`).
--   3. licence line compacts from "WA Lic number PL5415, ..." to
--      "WA PL5415 · QLD 15137160 · NSW 291745C · SA PGE284004".
--   4. Culligan confidentiality + virus disclaimer paragraphs drop from
--      10px/1.4 to 9px/1.3 so they no longer compete visually with the
--      message body.
--
-- Idempotent: the DO block checks for the literal logo placeholder before
-- updating, so a re-run is a no-op. Body content (licence numbers, Culligan
-- legal block) is preserved verbatim per Morty's locked decision — full
-- signature on every outbound is contractually required.

DO $$
DECLARE
  v_html_purezza      text;
  v_html_culligan     text;
  v_text_purezza      text;
  v_text_culligan     text;
BEGIN
  -- New HTML body — Purezza row (brand line: "Purezza Australia")
  v_html_purezza := concat(
    '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.3;color:#1f2937;"><strong>Jordan Marziale</strong><br/>Business Development Manager<br/>Purezza Australia<br/>Mobile: +61 409 355 713<br/>{{sending_mailbox_email}}</p>',
    E'\n',
    '<p style="margin:12px 0;font-family:Arial,sans-serif;font-size:12px;color:#64748b;">',
    '<img src="https://jordan-sales-agent.vercel.app/email-assets/culligan-logo.svg" alt="Culligan Group" width="120" style="display:inline-block;max-width:120px;height:auto;vertical-align:middle;margin-right:16px;"/>',
    '<img src="https://jordan-sales-agent.vercel.app/email-assets/purezza-logo.png" alt="Purezza Premium Water" width="120" style="display:inline-block;max-width:120px;height:auto;vertical-align:middle;"/>',
    '</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;">WA PL5415 · QLD 15137160 · NSW 291745C · SA PGE284004</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">Information contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">E-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.</p>'
  );

  -- New HTML body — Culligan Zip row (brand line: "Culligan Group")
  v_html_culligan := concat(
    '<p style="margin:0;font-family:Arial,sans-serif;font-size:13px;line-height:1.3;color:#1f2937;"><strong>Jordan Marziale</strong><br/>Business Development Manager<br/>Culligan Group<br/>Mobile: +61 409 355 713<br/>{{sending_mailbox_email}}</p>',
    E'\n',
    '<p style="margin:12px 0;font-family:Arial,sans-serif;font-size:12px;color:#64748b;">',
    '<img src="https://jordan-sales-agent.vercel.app/email-assets/culligan-logo.svg" alt="Culligan Group" width="120" style="display:inline-block;max-width:120px;height:auto;vertical-align:middle;margin-right:16px;"/>',
    '<img src="https://jordan-sales-agent.vercel.app/email-assets/purezza-logo.png" alt="Purezza Premium Water" width="120" style="display:inline-block;max-width:120px;height:auto;vertical-align:middle;"/>',
    '</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:10px;color:#94a3b8;">WA PL5415 · QLD 15137160 · NSW 291745C · SA PGE284004</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">Information contained in this e-mail from the Culligan Group and attachments are intended for the use of the addressee only and is confidential. If received in error, please delete it from your system and notify us by phone. Any dissemination, distribution, copying or use of this communication without prior permission of the addressee is strictly prohibited.</p>',
    E'\n',
    '<p style="margin:8px 0;font-family:Arial,sans-serif;font-size:9px;color:#94a3b8;line-height:1.3;">E-mail communication may be vulnerable to occurrences such as viruses, unauthorized amendment, unauthorized monitoring, tampering and data corruption. We correspond via e-mail subject to the condition that we are not liable for any such viruses, unauthorized amendments, unauthorized monitoring, tampering and/or data corruption or any consequences thereof.</p>'
  );

  -- New plaintext body — Purezza row
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

  -- New plaintext body — Culligan Zip row
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

  -- Idempotency guard: only update rows that still contain the literal
  -- placeholder. After this migration runs, the placeholder is gone and a
  -- re-run is a no-op.
  UPDATE public.email_signature_templates
  SET    body_html  = v_html_purezza,
         body_text  = v_text_purezza,
         updated_at = now()
  WHERE  brand_key  = 'purezza'
    AND  body_html LIKE '%[Culligan 90 Years logo]%';

  UPDATE public.email_signature_templates
  SET    body_html  = v_html_culligan,
         body_text  = v_text_culligan,
         updated_at = now()
  WHERE  brand_key  = 'culligan_zip'
    AND  body_html LIKE '%[Culligan 90 Years logo]%';
END $$;
