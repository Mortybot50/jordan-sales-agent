-- =============================================================================
-- In-app Claude chat — schema (P0-1)
-- Migration: 20260526051228_claude_conversations
-- =============================================================================
-- Adds two tables to back the per-contact "Ask Claude" drawer and the global
-- Cmd+K Claude command bar:
--   - claude_conversations: one per (user, scope, contact_id?) — UNIQUE-enforced
--   - claude_messages: append-only turn history with token + cost accounting
--
-- Read-only Claude in this PR — tool/function calling is Phase 2. RLS mirrors
-- the org-scoped pattern from lead_searches: callers can only see their own
-- org's rows, service role bypasses for the claude-chat Edge Function writes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CLAUDE CONVERSATIONS (one per user+scope+contact)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS claude_conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope      TEXT NOT NULL,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  title      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE claude_conversations
  DROP CONSTRAINT IF EXISTS claude_conversations_scope_check;

ALTER TABLE claude_conversations
  ADD CONSTRAINT claude_conversations_scope_check
  CHECK (scope IN ('global', 'contact'));

-- Scope/contact_id integrity: global has no contact, contact must have one
ALTER TABLE claude_conversations
  DROP CONSTRAINT IF EXISTS claude_conversations_scope_contact_check;

ALTER TABLE claude_conversations
  ADD CONSTRAINT claude_conversations_scope_contact_check
  CHECK (
    (scope = 'global'  AND contact_id IS NULL) OR
    (scope = 'contact' AND contact_id IS NOT NULL)
  );

-- Find-or-create key: one global per user; one per (user, contact). NULLs in
-- contact_id are NOT considered equal by default in UNIQUE, so we use two
-- partial unique indexes instead of UNIQUE (user_id, scope, contact_id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_conversations_user_global
  ON claude_conversations(user_id)
  WHERE scope = 'global';

CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_conversations_user_contact
  ON claude_conversations(user_id, contact_id)
  WHERE scope = 'contact';

CREATE INDEX IF NOT EXISTS idx_claude_conversations_org
  ON claude_conversations(org_id);

ALTER TABLE claude_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claude_conversations_select" ON claude_conversations
  FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "claude_conversations_insert" ON claude_conversations
  FOR INSERT WITH CHECK (org_id = auth_org_id());

CREATE POLICY "claude_conversations_update" ON claude_conversations
  FOR UPDATE USING (org_id = auth_org_id());

CREATE POLICY "claude_conversations_delete" ON claude_conversations
  FOR DELETE USING (org_id = auth_org_id());

CREATE POLICY "claude_conversations_service_role" ON claude_conversations
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 2. CLAUDE MESSAGES (append-only turn history)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS claude_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES claude_conversations(id) ON DELETE CASCADE,
  org_id          UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  cost_usd        NUMERIC,
  model           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE claude_messages
  DROP CONSTRAINT IF EXISTS claude_messages_role_check;

ALTER TABLE claude_messages
  ADD CONSTRAINT claude_messages_role_check
  CHECK (role IN ('user', 'assistant'));

CREATE INDEX IF NOT EXISTS idx_claude_messages_conversation
  ON claude_messages(conversation_id, created_at);

ALTER TABLE claude_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claude_messages_select" ON claude_messages
  FOR SELECT USING (org_id = auth_org_id());

CREATE POLICY "claude_messages_insert" ON claude_messages
  FOR INSERT WITH CHECK (org_id = auth_org_id());

CREATE POLICY "claude_messages_delete" ON claude_messages
  FOR DELETE USING (org_id = auth_org_id());

CREATE POLICY "claude_messages_service_role" ON claude_messages
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger on conversations (so the UI can sort by most-recent)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_claude_conversation_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE claude_conversations
  SET updated_at = NOW()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_claude_messages_touch_conv ON claude_messages;
CREATE TRIGGER trg_claude_messages_touch_conv
  AFTER INSERT ON claude_messages
  FOR EACH ROW EXECUTE FUNCTION touch_claude_conversation_updated_at();
