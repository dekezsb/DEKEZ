-- TTLock pushes unlock records to the approved application's callback URL.
-- Keep a seven-year, Super-Admin-only audit trail without storing passcodes,
-- access tokens or other provider secrets in the event payload.
create table if not exists public.smart_lock_unlock_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.smart_lock_devices(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid references public.properties(id) on delete restrict,
  room_id uuid references public.rooms(id) on delete restrict,
  provider_record_id text not null,
  provider_lock_id bigint not null,
  event_type text,
  occurred_at timestamptz,
  event_payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  retain_until date not null default ((now() at time zone 'Asia/Kuala_Lumpur')::date + interval '7 years')::date,
  constraint smart_lock_unlock_event_unique unique (device_id, provider_record_id)
);

create index if not exists smart_lock_unlock_events_device_time_idx
  on public.smart_lock_unlock_events (device_id, occurred_at desc);

create index if not exists smart_lock_unlock_events_retention_idx
  on public.smart_lock_unlock_events (retain_until);

alter table public.smart_lock_unlock_events enable row level security;

drop policy if exists "smart_lock_unlock_events_super_admin_select"
  on public.smart_lock_unlock_events;

create policy "smart_lock_unlock_events_super_admin_select"
on public.smart_lock_unlock_events
for select
to authenticated
using (public.current_profile_role() = 'super_admin');

revoke all on public.smart_lock_unlock_events from public, anon, authenticated;
grant select on public.smart_lock_unlock_events to authenticated;
grant all on public.smart_lock_unlock_events to service_role;

update public.smart_lock_devices
set
  provider_data = provider_data
    - 'source'
    - 'live_data'
    || jsonb_build_object('source', 'ttlock_installed_property_inventory', 'liveData', true),
  updated_at = now()
where provider = 'ttlock'
  and sync_status = 'connected';
