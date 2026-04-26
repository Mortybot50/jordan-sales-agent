-- Proposed-meetings flag for the draft queue.
-- Lets the AI mark drafts that need Jordan's diary input before send.
-- Body for these drafts must contain the literal token [YOUR_TIMES_HERE]
-- which Jordan replaces with real time slots prior to approving.

ALTER TABLE email_drafts
  ADD COLUMN IF NOT EXISTS draft_kind text NOT NULL DEFAULT 'standard'
    CHECK (draft_kind IN ('standard', 'proposed_meeting'));

CREATE INDEX IF NOT EXISTS idx_drafts_kind
  ON email_drafts (org_id, status, draft_kind)
  WHERE draft_kind = 'proposed_meeting';

COMMENT ON COLUMN email_drafts.draft_kind IS
  'Discriminator for drafts that need human-side action before send. proposed_meeting = body contains [YOUR_TIMES_HERE] and Jordan must replace with real diary slots before approving.';
