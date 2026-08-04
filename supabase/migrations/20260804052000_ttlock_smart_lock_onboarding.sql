-- TTLock trial inventory. Device snapshots are deliberately kept separate
-- from room assignments until the Super Admin confirms the physical mapping.
create table if not exists public.smart_lock_devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid references public.properties(id) on delete restrict,
  room_id uuid references public.rooms(id) on delete restrict,
  provider text not null default 'ttlock',
  provider_lock_id bigint,
  provider_lock_name text not null,
  provider_group_name text,
  provider_group_id bigint,
  onboarding_key text not null,
  battery_level smallint,
  has_gateway boolean,
  sync_status text not null default 'awaiting_api_approval',
  last_sync_error text,
  snapshot_captured_at timestamptz,
  last_synced_at timestamptz,
  provider_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_lock_provider_check check (provider = 'ttlock'),
  constraint smart_lock_battery_check check (battery_level between 0 and 100),
  constraint smart_lock_sync_status_check check (
    sync_status in (
      'awaiting_api_approval',
      'credentials_required',
      'pending_sync',
      'connected',
      'offline',
      'error',
      'retired'
    )
  ),
  constraint smart_lock_onboarding_unique unique (company_id, provider, onboarding_key)
);

create unique index if not exists smart_lock_provider_id_unique_idx
  on public.smart_lock_devices (company_id, provider, provider_lock_id)
  where provider_lock_id is not null;

create index if not exists smart_lock_property_idx
  on public.smart_lock_devices (property_id, sync_status);

create index if not exists smart_lock_room_idx
  on public.smart_lock_devices (room_id)
  where room_id is not null;

alter table public.smart_lock_devices enable row level security;

drop policy if exists "smart_lock_super_admin_select" on public.smart_lock_devices;

create policy "smart_lock_super_admin_select"
on public.smart_lock_devices
for select
to authenticated
using (public.current_profile_role() = 'super_admin');

revoke all on public.smart_lock_devices from public, anon, authenticated;
grant select on public.smart_lock_devices to authenticated;
grant all on public.smart_lock_devices to service_role;

insert into public.smart_lock_devices (
  company_id,
  property_id,
  provider_lock_name,
  provider_group_name,
  onboarding_key,
  battery_level,
  sync_status,
  snapshot_captured_at,
  provider_data
)
select
  property.company_id,
  property.id,
  trial.lock_name,
  'BUNDUSAN SQUARE OFFICE',
  trial.onboarding_key,
  trial.battery_level,
  'awaiting_api_approval',
  now(),
  jsonb_build_object(
    'source', 'ttlock_web_trial_snapshot',
    'live_data', false
  )
from public.properties as property
cross join (
  values
    ('BDS MAIN OFFICE', 'bds-main-office', 100::smallint),
    ('BDS OFFICE 2', 'bds-office-2', 100::smallint),
    ('BDS OFFICE 5', 'bds-office-5', 90::smallint),
    ('BDS OFFICE 6', 'bds-office-6', 90::smallint)
) as trial(lock_name, onboarding_key, battery_level)
where upper(coalesce(property.property_code, '')) = 'BDS'
  and property.company_id is not null
on conflict (company_id, provider, onboarding_key) do update
set
  property_id = excluded.property_id,
  provider_lock_name = excluded.provider_lock_name,
  provider_group_name = excluded.provider_group_name,
  battery_level = excluded.battery_level,
  snapshot_captured_at = excluded.snapshot_captured_at,
  provider_data = excluded.provider_data,
  updated_at = now()
where public.smart_lock_devices.provider_lock_id is null;
