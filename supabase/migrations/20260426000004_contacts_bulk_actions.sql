-- =============================================================================
-- Contacts bulk actions: tags + Do Not Call (DNC)
-- =============================================================================
-- Adds contact_tags table for cohort labelling and a do_not_contact flag on
-- contacts. Tags drive the cohort filter strip on the Contacts page; DNC is
-- a hard exclusion enforced in draft generation.
-- =============================================================================

-- 1. contact_tags table (label N contacts with a free-form tag)
CREATE TABLE IF NOT EXISTS contact_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  tag text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, contact_id, tag),
  -- Tag shape: lowercase, 1-30 chars, alphanumeric + dashes only.
  CONSTRAINT contact_tags_tag_format CHECK (tag ~ '^[a-z0-9][a-z0-9-]{0,29}$')
);

CREATE INDEX IF NOT EXISTS idx_contact_tags_lookup ON contact_tags (org_id, tag);
CREATE INDEX IF NOT EXISTS idx_contact_tags_contact ON contact_tags (contact_id);

ALTER TABLE contact_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_tags_select" ON contact_tags;
CREATE POLICY "contact_tags_select" ON contact_tags
  FOR SELECT USING (org_id = auth_org_id());

DROP POLICY IF EXISTS "contact_tags_insert" ON contact_tags;
CREATE POLICY "contact_tags_insert" ON contact_tags
  FOR INSERT WITH CHECK (org_id = auth_org_id());

DROP POLICY IF EXISTS "contact_tags_delete" ON contact_tags;
CREATE POLICY "contact_tags_delete" ON contact_tags
  FOR DELETE USING (org_id = auth_org_id());

-- 2. contacts.do_not_contact (DNC flag — hard outreach exclusion)
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS do_not_contact boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_contacts_dnc
  ON contacts (org_id)
  WHERE do_not_contact = true;

COMMENT ON COLUMN contacts.do_not_contact IS
  'When true, contact is excluded from auto-sourcing, draft generation, and any outreach surfaces.';
