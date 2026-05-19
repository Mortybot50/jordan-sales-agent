-- =============================================================================
-- LeadFlow native sender — Week 2 P2 follow-up: repoint email_drafts FK.
-- Migration: 20260519000007_email_drafts_sender_inbox_fk
-- =============================================================================
-- email_drafts.sender_inbox_id was created with an FK to the legacy
-- `sender_inboxes` table. Week 1 introduced `email_accounts` as the new
-- canonical sender-mailbox table. Pinned-inbox drafts (sender_inbox_id set)
-- referencing an email_accounts.id would FK-violate today.
--
-- Repoint the FK to email_accounts(id) with ON DELETE SET NULL so a deleted
-- sending mailbox doesn't cascade-nuke historical drafts. The 19/05 test gate
-- pre-flight confirmed there are currently zero drafts with sender_inbox_id
-- set (or otherwise orphaned), so the rewrite is safe.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0. Safety probe: refuse to drop the constraint if there are existing rows
--    that would orphan against email_accounts.
-- ---------------------------------------------------------------------------
do $$
declare orphan_count int;
begin
  select count(*) into orphan_count
    from public.email_drafts d
   where d.sender_inbox_id is not null
     and d.sender_inbox_id not in (select id from public.email_accounts);
  if orphan_count > 0 then
    raise exception
      'cannot repoint email_drafts.sender_inbox_id FK: % rows would orphan '
      'against email_accounts. Reconcile data first.', orphan_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Drop the legacy FK (idempotent — IF EXISTS).
-- ---------------------------------------------------------------------------
alter table public.email_drafts
  drop constraint if exists email_drafts_sender_inbox_id_fkey;

-- ---------------------------------------------------------------------------
-- 2. Add the new FK pointing at email_accounts.
-- ---------------------------------------------------------------------------
alter table public.email_drafts
  add constraint email_drafts_sender_inbox_id_fkey
  foreign key (sender_inbox_id)
  references public.email_accounts (id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- 3. Probe: confirm the new FK target is email_accounts.
-- ---------------------------------------------------------------------------
do $$
declare target text;
begin
  select ccu.table_name into target
  from information_schema.table_constraints tc
  join information_schema.constraint_column_usage ccu
    on ccu.constraint_name = tc.constraint_name
   and ccu.table_schema   = tc.table_schema
  where tc.constraint_type = 'FOREIGN KEY'
    and tc.table_schema    = 'public'
    and tc.table_name      = 'email_drafts'
    and tc.constraint_name = 'email_drafts_sender_inbox_id_fkey';
  if target is null or target <> 'email_accounts' then
    raise exception
      'email_drafts.sender_inbox_id FK did not repoint to email_accounts (target=%)', target;
  end if;
end $$;
