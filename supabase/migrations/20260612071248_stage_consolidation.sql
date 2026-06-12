-- =============================================================================
-- Pipeline stage consolidation — Jordan's 8 stages + de-emphasised Hold
-- Migration: 20260612071248_stage_consolidation
-- =============================================================================
-- Settled decision (12/06/2026): stages are exactly
--   New, Contacted, Replied, Meeting Booked, Site Visit, Proposal Sent,
--   Closed, Lost  + "Hold for Next Month" as a utility column.
--
-- Live state before this migration (deals per stage):
--   New:18 Contacted:65 Replied:254 Meeting Booked:2 Site Visit:0
--   Proposal Sent:0 Demo Completed:0 Negotiation:0 Hold:0 Closed Won:0
--   Pending Install:0 Installed:1 Closed Lost:0
--
-- Mapping: Closed Won -> renamed Closed. Closed Lost -> renamed Lost.
-- Installed / Pending Install deals -> Closed (the install lifecycle is
-- column-driven: install_scheduled_for/confirmed/completed_at — no stage
-- dependency; verified zero stage-name coupling in dashboards beyond the
-- /won/i lookups updated in the same commit). Demo Completed / Negotiation
-- deals -> Proposal Sent (both empty today; rule kept for replay safety).
-- =============================================================================

-- 1. Renames (keep ids — FKs and history untouched)
update public.pipeline_stages set name = 'Closed' where name = 'Closed Won';
update public.pipeline_stages set name = 'Lost'   where name = 'Closed Lost';

-- 2. Remap deals off the stages being removed
update public.deals d
   set stage_id = (select s.id from public.pipeline_stages s
                    where s.org_id = d.org_id and s.name = 'Closed')
 where d.stage_id in (select id from public.pipeline_stages
                       where name in ('Installed', 'Pending Install'));

update public.deals d
   set stage_id = (select s.id from public.pipeline_stages s
                    where s.org_id = d.org_id and s.name = 'Proposal Sent')
 where d.stage_id in (select id from public.pipeline_stages
                       where name in ('Demo Completed', 'Negotiation'));

-- 3. Remove the emptied stages
delete from public.pipeline_stages
 where name in ('Installed', 'Pending Install', 'Demo Completed', 'Negotiation');

-- 4. Canonical order + closed flags
update public.pipeline_stages set position = 1, is_closed = false where name = 'New';
update public.pipeline_stages set position = 2, is_closed = false where name = 'Contacted';
update public.pipeline_stages set position = 3, is_closed = false where name = 'Replied';
update public.pipeline_stages set position = 4, is_closed = false where name = 'Meeting Booked';
update public.pipeline_stages set position = 5, is_closed = false where name = 'Site Visit';
update public.pipeline_stages set position = 6, is_closed = false where name = 'Proposal Sent';
update public.pipeline_stages set position = 7, is_closed = true  where name = 'Closed';
update public.pipeline_stages set position = 8, is_closed = true  where name = 'Lost';
update public.pipeline_stages set position = 9, is_closed = false where name = 'Hold for Next Month';
