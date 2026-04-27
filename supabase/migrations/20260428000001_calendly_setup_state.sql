-- Calendly setup-state tracking columns
-- Powers the "Connect Calendly" walkthrough card in Settings:
-- both fields are nullable timestamps that the UI sets when the user
-- ticks off a manual step (webhook registered, test booking sent).
-- calendly_account_email already exists on users (added in a prior migration).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS calendly_webhook_registered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS calendly_test_booking_at TIMESTAMPTZ NULL;
