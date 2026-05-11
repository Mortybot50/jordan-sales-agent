-- Normalise emails on insert/update into suppression_list to match the
-- normalisation done by is_suppressed() at read time. Without this, any row
-- with a +alias (e.g. user+something@example.com) never matches an incoming
-- email after is_suppressed() strips the +alias from the input. This caused
-- a silent suppression bypass — caught during the 11/05 3-touch dry run.
--
-- Rule mirrors is_suppressed(): lowercase, trim, strip +alias from local part.
-- Domain-suppression rows (domain_suppression = true) are stored as bare
-- domain — those are not normalised through the local-part path.

create or replace function public.normalise_suppression_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_raw    text;
  v_at     int;
  v_local  text;
  v_domain text;
begin
  if NEW.email is null then return NEW; end if;
  v_raw := lower(btrim(NEW.email));

  if NEW.domain_suppression then
    -- Domain-only row: leave the value alone but lowercase it.
    NEW.email := v_raw;
    return NEW;
  end if;

  v_at := position('@' in v_raw);
  if v_at = 0 then
    -- Not a valid email; leave for downstream validation to surface.
    NEW.email := v_raw;
    return NEW;
  end if;

  v_local  := split_part(substring(v_raw from 1 for v_at - 1), '+', 1);
  v_domain := substring(v_raw from v_at + 1);
  NEW.email := v_local || '@' || v_domain;
  return NEW;
end;
$$;

drop trigger if exists suppression_list_normalise_email on public.suppression_list;
create trigger suppression_list_normalise_email
  before insert or update on public.suppression_list
  for each row execute function public.normalise_suppression_email();

-- One-time backfill: normalise any existing rows that have +alias / mixed case
-- already in the table. Trigger will fire on the update path and rewrite each
-- row through normalise_suppression_email().
update public.suppression_list set email = email where email is not null;

comment on function public.normalise_suppression_email() is
  'Mirrors is_suppressed() at INSERT/UPDATE time so the stored value matches what is_suppressed() compares against (lowercased, trimmed, +alias stripped). Without this, suppression rows containing +alias silently bypass the guard.';

-- Also patch email_drafts_suppression_guard() to normalise the contact's email
-- when looking up the reason. Without this, the gate fires correctly (because
-- is_suppressed normalises both sides) but suppression_reason resolves to
-- 'unknown' instead of the real reason — caught during the same 11/05 test.

create or replace function public.email_drafts_suppression_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_reason  text;
  v_raw     text;
  v_at      int;
  v_local   text;
  v_domain  text;
  v_norm    text;
begin
  if NEW.status not in ('approved','queued') then return NEW; end if;
  if NEW.contact_id is null then return NEW; end if;
  select c.email into v_email from public.contacts c where c.id = NEW.contact_id limit 1;
  if v_email is null then return NEW; end if;
  if public.is_suppressed(NEW.org_id, v_email) then
    v_raw := lower(btrim(v_email));
    v_at  := position('@' in v_raw);
    if v_at > 0 then
      v_local  := split_part(substring(v_raw from 1 for v_at - 1), '+', 1);
      v_domain := substring(v_raw from v_at + 1);
      v_norm   := v_local || '@' || v_domain;
    else
      v_norm   := v_raw;
      v_domain := '';
    end if;

    select sl.reason into v_reason from public.suppression_list sl
    where sl.org_id = NEW.org_id
      and ((sl.domain_suppression = false and sl.email = v_norm)
        or (sl.domain_suppression = true  and sl.email = v_domain))
    limit 1;

    NEW.status := 'suppressed';
    NEW.suppression_reason := coalesce(v_reason, 'unknown');
    NEW.approved_at := null;
  end if;
  return NEW;
end;
$$;
