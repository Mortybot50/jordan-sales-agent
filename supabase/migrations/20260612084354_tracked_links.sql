-- =============================================================================
-- Stored click-tracking links (P2-2 — kill the ?url= open-redirect surface)
-- Migration: 20260612084354_tracked_links
-- =============================================================================
-- click-redirect used to trust a ?url= query param verbatim (scheme-checked,
-- but the destination travelled in the email and was attacker-mutable on the
-- wire). This table stores destinations server-side keyed by an opaque token;
-- click-redirect resolves token -> destination and never reads a url param.
--
-- Click tracking is not yet wired into the send path, so there is no live
-- ?url= traffic to migrate — this lands the secure model before it's used.
-- =============================================================================

create table if not exists public.tracked_links (
  token            uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.orgs(id) on delete cascade,
  send_queue_id    uuid references public.email_send_queue(id) on delete set null,
  destination_url  text not null,
  created_at       timestamptz not null default now(),
  constraint tracked_links_dest_http
    check (destination_url ~* '^https?://')
);

create index if not exists tracked_links_send_queue_idx
  on public.tracked_links (send_queue_id);

alter table public.tracked_links enable row level security;

-- Service-role only — links are minted by the send pipeline and resolved by
-- the (service-role) click-redirect function. No end-user surface.
create policy tracked_links_service_role on public.tracked_links
  for all to public
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
