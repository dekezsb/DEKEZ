-- Connect the verified HLT CNYIOT prepaid electricity-meter inventory (migration registered remotely).
-- Provider secrets stay in Vercel; Postgres stores device IDs and readings only.
alter table public.smart_meters
  add column if not exists provider text not null default 'manual',
  add column if not exists provider_meter_id text,
  add column if not exists remaining_units numeric(14, 3) not null default 0,
  add column if not exists unit_label text not null default 'kWh',
  add column if not exists connection_status text not null default 'unknown',
  add column if not exists power_state text not null default 'unknown',
  add column if not exists last_reported_at timestamptz,
  add column if not exists last_synced_at timestamptz,
  add column if not exists last_sync_error text,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb;

alter table public.smart_meters
  drop constraint if exists smart_meters_provider_check,
  add constraint smart_meters_provider_check
    check (provider in ('manual', 'cnyiot')),
  drop constraint if exists smart_meters_remaining_units_check,
  add constraint smart_meters_remaining_units_check
    check (remaining_units >= 0),
  drop constraint if exists smart_meters_connection_status_check,
  add constraint smart_meters_connection_status_check
    check (connection_status in ('online', 'offline', 'unknown')),
  drop constraint if exists smart_meters_power_state_check,
  add constraint smart_meters_power_state_check
    check (power_state in ('on', 'off', 'unknown'));

create unique index if not exists smart_meters_provider_meter_unique
  on public.smart_meters (provider, provider_meter_id)
  where provider_meter_id is not null;

create index if not exists smart_meters_property_provider_status_idx
  on public.smart_meters (property_id, provider, status);

with incoming(room_number, meter_number, remaining_units, power_state, reported_at) as (
  values
    ('Room 1', '18201009497', 101.170::numeric, 'on',  '2026-08-05 14:45:37+08'::timestamptz),
    ('Room 2', '18201010362',   0.000::numeric, 'off', '2026-08-05 14:46:33+08'::timestamptz),
    ('Room 3', '18201009430',  49.980::numeric, 'on',  '2026-08-05 14:47:01+08'::timestamptz),
    ('Room 4', '18201009422',  72.070::numeric, 'on',  '2026-08-05 14:46:31+08'::timestamptz),
    ('Room 5', '18201009505',  11.900::numeric, 'on',  '2026-08-05 14:45:27+08'::timestamptz),
    ('Room 6', '18201009489',  13.940::numeric, 'on',  '2026-08-05 14:44:31+08'::timestamptz),
    ('Room 7', '18201010370',  32.270::numeric, 'on',  '2026-08-05 14:43:58+08'::timestamptz),
    ('Room 8', '18201009448',  63.370::numeric, 'on',  '2026-08-05 14:44:53+08'::timestamptz),
    ('Room 9', '18201010073',  72.580::numeric, 'on',  '2026-08-05 14:46:20+08'::timestamptz)
),
mapped as (
  select
    properties.id as property_id,
    rooms.id as room_id,
    active_tenancy.tenant_id,
    active_tenancy.id as tenancy_id,
    incoming.*
  from incoming
  join public.properties as properties
    on properties.property_code = 'HLT'
  join public.rooms as rooms
    on rooms.property_id = properties.id
   and rooms.room_number = incoming.room_number
  left join lateral (
    select tenancies.id, tenancies.tenant_id
    from public.tenancies as tenancies
    where tenancies.property_id = properties.id
      and tenancies.room_id = rooms.id
      and tenancies.status = 'active'
    order by tenancies.created_at desc
    limit 1
  ) as active_tenancy on true
)
insert into public.smart_meters (
  property_id,
  room_id,
  tenant_id,
  tenancy_id,
  meter_number,
  meter_type,
  rate,
  remaining_credit,
  status,
  provider,
  provider_meter_id,
  remaining_units,
  unit_label,
  connection_status,
  power_state,
  last_reported_at,
  last_synced_at,
  last_sync_error,
  provider_metadata,
  updated_at
)
select
  property_id,
  room_id,
  tenant_id,
  tenancy_id,
  meter_number,
  'electricity',
  0.5700,
  0,
  'active',
  'cnyiot',
  meter_number,
  remaining_units,
  'kWh',
  'online',
  power_state,
  reported_at,
  now(),
  null,
  jsonb_build_object(
    'provider_name', 'Zhejiang Chenyu IoT',
    'platform', 'CNYIOT Smart Control',
    'device_type', 'single_phase_wifi_prepaid',
    'import_source', 'verified_account_inventory'
  ),
  now()
from mapped
on conflict (property_id, meter_number)
do update set
  room_id = excluded.room_id,
  tenant_id = excluded.tenant_id,
  tenancy_id = excluded.tenancy_id,
  meter_type = excluded.meter_type,
  rate = excluded.rate,
  status = excluded.status,
  provider = excluded.provider,
  provider_meter_id = excluded.provider_meter_id,
  remaining_units = excluded.remaining_units,
  unit_label = excluded.unit_label,
  connection_status = excluded.connection_status,
  power_state = excluded.power_state,
  last_reported_at = excluded.last_reported_at,
  last_synced_at = excluded.last_synced_at,
  last_sync_error = null,
  provider_metadata = excluded.provider_metadata,
  updated_at = now();
