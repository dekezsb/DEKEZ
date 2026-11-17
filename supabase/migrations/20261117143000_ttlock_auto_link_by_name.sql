-- Record whether a TTLock lock or meter was auto-linked from its alias,
-- so staff can see that and unassign it if the room is wrong.
-- These columns are nullable and must not change existing assignments.

alter table public.smart_lock_devices
  add column if not exists assignment_source text,
  add column if not exists auto_linked_at timestamptz,
  add column if not exists auto_link_skip_reason text;

alter table public.smart_lock_devices
  drop constraint if exists smart_lock_devices_assignment_source_check;

alter table public.smart_lock_devices
  add constraint smart_lock_devices_assignment_source_check
    check (assignment_source is null or assignment_source in ('manual', 'auto_alias'));

comment on column public.smart_lock_devices.assignment_source is
  'How the current property/room was set: auto_alias from the device name, or manual confirmation.';
comment on column public.smart_lock_devices.auto_linked_at is
  'When the current assignment was applied automatically from the device name.';
comment on column public.smart_lock_devices.auto_link_skip_reason is
  'Why an unassigned lock was not auto-linked, if a name match was attempted.';

alter table public.smart_meters
  add column if not exists assignment_source text,
  add column if not exists auto_linked_at timestamptz,
  add column if not exists auto_link_skip_reason text;

alter table public.smart_meters
  drop constraint if exists smart_meters_assignment_source_check;

alter table public.smart_meters
  add constraint smart_meters_assignment_source_check
    check (assignment_source is null or assignment_source in ('manual', 'auto_alias'));

comment on column public.smart_meters.assignment_source is
  'How the current property/room was set: auto_alias from the device name, or manual confirmation.';
comment on column public.smart_meters.auto_linked_at is
  'When the current assignment was applied automatically from the device name.';
comment on column public.smart_meters.auto_link_skip_reason is
  'Why an unassigned meter was not auto-linked, if a name match was attempted.';
