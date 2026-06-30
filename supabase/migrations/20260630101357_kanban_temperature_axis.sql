-- Kanban temperature-axis restructure.
-- Adds the Installed outcome stage, deal-level proposal/held tracking columns,
-- migrates the standalone "Hold for Next Month" stage onto a card-level held flag,
-- then removes that stage. See plan: kanban-temperature-axis-restructure-2026-06-30.md

begin;

-- 1. Deal-level columns: proposal sent timestamp + held flag/date.
alter table public.deals
  add column if not exists proposal_sent_at timestamptz,
  add column if not exists is_held boolean not null default false,
  add column if not exists held_until date;

-- 2. Backfill proposal_sent_at for deals already sitting in "Proposal Sent"
--    (best-effort: prefer last_touch_at, else updated_at, else created_at).
update public.deals d
set proposal_sent_at = coalesce(d.last_touch_at, d.updated_at, d.created_at)
from public.pipeline_stages s
where d.stage_id = s.id
  and s.name = 'Proposal Sent'
  and d.proposal_sent_at is null;

-- 3. Migrate deals on the "Hold for Next Month" stage onto the held flag.
--    They keep their temperature; stage is reset to a natural outreach stage so
--    they render in their temperature column. held_until = first of next month.
update public.deals d
set is_held = true,
    held_until = (date_trunc('month', now()) + interval '1 month')::date,
    stage_id = (
      select s2.id from public.pipeline_stages s2
      where s2.org_id = d.org_id
        and s2.name = case when d.last_touch_at is not null then 'Contacted' else 'New' end
      limit 1
    ),
    updated_at = now()
from public.pipeline_stages s
where d.stage_id = s.id
  and s.name = 'Hold for Next Month';

-- 4. Remove the now-empty "Hold for Next Month" stage.
delete from public.pipeline_stages where name = 'Hold for Next Month';

-- 5. Add the Installed stage between Closed (7) and Lost.
--    Shift Lost to position 9, insert Installed at position 8.
--    Installed is a post-Closed fulfilment state: is_closed = true so it
--    counts as won in dashboards and is suppressed from aging.
update public.pipeline_stages set position = 9 where name = 'Lost';

insert into public.pipeline_stages (org_id, name, position, is_closed, color)
select id, 'Installed', 8, true, '#0ea5e9'
from public.orgs
where not exists (
  select 1 from public.pipeline_stages s
  where s.org_id = orgs.id and s.name = 'Installed'
);

commit;
