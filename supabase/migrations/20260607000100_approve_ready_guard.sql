-- P2-9 (BLOCKER): enforce outbound-send readiness server-side.
--
-- The Draft Review screen has a client-side pre-flight guard (useApproveDraft)
-- that blocks approving a draft until the owner has (1) a profile name,
-- (2) at least one brand signature, and (3) at least one active sending inbox.
-- But that guard is UI-only: the send worker (enqueue-sends) queues ANY
-- email_drafts row with status='approved'. A direct DB update, a stale client,
-- a script, or a compromised session could set status='approved' and bypass
-- the guard entirely — drafts would queue and the worker would try to send
-- with no inbox/signature configured.
--
-- This migration moves the gate into the database as a BEFORE UPDATE trigger,
-- so the pending/edited -> approved transition is impossible unless the owning
-- user is actually set up to send. enqueue-sends carries a matching recheck as
-- a final safety net (defence in depth).
--
-- Readiness mirrors src/lib/queries/outboundReadiness.ts exactly:
--   profile name set  : public.users.full_name is non-blank
--   has signature     : >= 1 public.email_signature_templates for the user
--   has active inbox  : >= 1 public.email_accounts (status='active') for the user
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_email_drafts_approve_ready ON public.email_drafts;
--   DROP FUNCTION IF EXISTS public.assert_draft_approve_ready();

create or replace function public.assert_draft_approve_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_name_set boolean;
  v_has_signature    boolean;
  v_has_inbox        boolean;
  v_missing          text[] := '{}';
begin
  -- Only gate the transition INTO approved. Edits, rejects, sends, and
  -- re-saves of an already-approved row pass straight through.
  if new.status is distinct from 'approved'
     or old.status is not distinct from 'approved' then
    return new;
  end if;

  if new.created_by is null then
    raise exception
      'Cannot approve draft %: it has no owner (created_by is null), so send-readiness cannot be verified.',
      new.id
      using errcode = 'check_violation';
  end if;

  select coalesce(btrim(u.full_name) <> '', false)
    into v_profile_name_set
    from public.users u
   where u.id = new.created_by;

  -- No public.users row at all -> definitely not ready.
  v_profile_name_set := coalesce(v_profile_name_set, false);

  select exists (
    select 1 from public.email_signature_templates s
     where s.user_id = new.created_by
  ) into v_has_signature;

  select exists (
    select 1 from public.email_accounts a
     where a.user_id = new.created_by
       and a.status = 'active'
  ) into v_has_inbox;

  -- array_append (not the `||` operator): text[] || text is ambiguous in
  -- Postgres and tries to parse the RHS string as an array literal.
  if not v_profile_name_set then v_missing := array_append(v_missing, 'your profile name'); end if;
  if not v_has_signature    then v_missing := array_append(v_missing, 'at least one brand signature'); end if;
  if not v_has_inbox        then v_missing := array_append(v_missing, 'a connected sending inbox'); end if;

  if array_length(v_missing, 1) is not null then
    raise exception
      'Cannot approve draft %: finish outbound setup first — still need %.',
      new.id, array_to_string(v_missing, ' + ')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_email_drafts_approve_ready on public.email_drafts;
create trigger trg_email_drafts_approve_ready
  before update on public.email_drafts
  for each row
  execute function public.assert_draft_approve_ready();

-- This is a trigger-only function; it never needs to be callable via PostgREST
-- RPC. Revoke EXECUTE so it isn't exposed at /rest/v1/rpc (it would error
-- outside a trigger anyway, but this keeps the API surface clean). Trigger
-- invocation is unaffected by EXECUTE grants.
revoke execute on function public.assert_draft_approve_ready() from public, anon, authenticated;
