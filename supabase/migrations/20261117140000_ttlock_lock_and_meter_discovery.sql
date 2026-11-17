-- Allow TTLock electric meters discovered from the account to be stored
-- unassigned until a Super Admin confirms the property and room.
-- Lock discovery uses the existing nullable property_id/room_id columns
-- on smart_lock_devices and does not need a schema change.
alter table public.smart_meters
  alter column property_id drop not null,
  alter column room_id drop not null;

alter table public.smart_meters
  drop constraint if exists smart_meters_provider_check;

alter table public.smart_meters
  add constraint smart_meters_provider_check
    check (provider in ('manual', 'cnyiot', 'ttlock'));

alter table public.smart_meters
  drop constraint if exists smart_meters_assignment_check;

alter table public.smart_meters
  add constraint smart_meters_assignment_check
    check (
      (property_id is null and room_id is null)
      or (property_id is not null and room_id is not null)
    );

alter table public.smart_meters
  add column if not exists total_units numeric(14, 3);

comment on column public.smart_meters.total_units is
  'Total usage reported by the provider, in unit_label (usually kWh).';
