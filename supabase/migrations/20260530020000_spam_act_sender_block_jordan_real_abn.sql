-- =============================================================================
-- 20260530020000_spam_act_sender_block_jordan_real_abn.sql
-- =============================================================================
-- Purpose
--   Replace the placeholder Spam Act sender block (placeholder ABN
--   "12 345 678 901" / "PO Box 123, Melbourne VIC 3000") with Jordan's real
--   ABN-only footer.
--
-- Supersedes
--   The seed at lines 213-224 of supabase/migrations/20260519000003_warmup_and_spam_act.sql
--   which wrote the placeholder value into public.users for demo@jordan-sales-agent.test
--   and jordan@purezza.com.au pending a real value from Jordan.
--
-- Authorisation
--   Jordan Marziale (+61416104718) via WhatsApp, 30/05/2026 12:20 AEST -- "Ship it".
--   See clients/jordan/IDENTITY.md -- Cold-send decisions, 30/05/2026 entry.
--
-- Compliance trade-off (deliberate)
--   The new footer is ABN-only. It deliberately omits a street address.
--   Spam Act 2003 (Cth) s.17 / Spam Regulations 2021 require commercial
--   electronic messages to include "accurate information about the individual
--   or organisation that authorised the sending of the message"; in practice
--   ACMA guidance reads this as name + a way to identify the sender (ABN /
--   business contact). The residual risk that ACMA could view ABN-without-
--   street-address as non-compliant has been raised with Jordan, weighed
--   against (a) Jordan not wanting his home address in commercial bulk send
--   and (b) ABN being a uniquely-identifying public registry lookup, and
--   accepted in writing on the WhatsApp thread. This migration encodes that
--   decision; revisit if ACMA position changes or a business PO Box is
--   stood up.
--
-- Idempotency
--   The UPDATE is scoped to the two seeded emails (demo + jordan@purezza)
--   AND requires the placeholder predicate. Replaying this migration on a DB where production already
--   contains the new value is a 0-row no-op.
-- =============================================================================

UPDATE public.users
   SET spam_act_sender_block = 'Jordan Marziale - ABN 78 180 361 897 - Reply STOP or click the unsubscribe link above.'
 WHERE email IN ('demo@jordan-sales-agent.test', 'jordan@purezza.com.au')
   AND (spam_act_sender_block ILIKE '%12 345 678 901%'
        OR spam_act_sender_block ILIKE '%PO Box 123%');
