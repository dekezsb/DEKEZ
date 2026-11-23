-- TTLock app eKeys ("Unlock with APP") and TTLock meter power control.
--
-- 1. tenants.ttlock_username: the phone number or email the tenant uses to
--    log in to the TTLock app. eKeys are only sent when it is set.
-- 2. smart_lock_ekey_grants: one open eKey per lock and tenancy, mirroring
--    smart_lock_access_grants (passcodes) so checkout, contract-end cleanup
--    and payment extensions follow the same lifecycle.
-- 3. smart_meters power audit columns so a meter DEKEZ switched off at
--    checkout is switched back on for the next move-in (and only then).

alter table public.tenants
  add column if not exists ttlock_username text;

alter table public.tenants
  drop constraint if exists tenants_ttlock_username_check;

alter table public.tenants
  add constraint tenants_ttlock_username_check
    check (ttlock_username is null or char_length(ttlock_username) between 4 and 100);

comment on column public.tenants.ttlock_username is
  'TTLock app account (phone with country code, or email) that receives the tenant''s eKeys.';

create table if not exists public.smart_lock_ekey_grants (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.smart_lock_devices(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  room_id uuid references public.rooms(id) on delete restrict,
  tenancy_id uuid not null references public.tenancies(id) on delete restrict,
  tenant_profile_id uuid not null references auth.users(id) on delete restrict,
  access_scope text not null,
  receiver_username text not null,
  key_name text,
  provider_key_id bigint,
  credential_state text not null default 'pending_send',
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  activated_at timestamptz,
  frozen_at timestamptz,
  revoke_requested_at timestamptz,
  revoked_at timestamptz,
  last_extension_reference text,
  last_provider_sync_at timestamptz,
  provider_status jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_lock_ekey_scope_check
    check (access_scope in ('property_entry', 'room_entry')),
  constraint smart_lock_ekey_state_check
    check (
      credential_state in (
        'pending_send',
        'active',
        'frozen',
        'revoke_pending',
        'revoked',
        'error'
      )
    ),
  constraint smart_lock_ekey_valid_period_check check (valid_until > valid_from),
  constraint smart_lock_ekey_room_scope_check
    check (access_scope <> 'room_entry' or room_id is not null),
  constraint smart_lock_ekey_revoked_check
    check (credential_state <> 'revoked' or revoked_at is not null)
);

create unique index if not exists smart_lock_ekey_one_open_grant_idx
  on public.smart_lock_ekey_grants (device_id, tenancy_id)
  where credential_state in ('pending_send', 'active', 'frozen', 'revoke_pending');

create unique index if not exists smart_lock_ekey_provider_key_unique_idx
  on public.smart_lock_ekey_grants (provider_key_id)
  where provider_key_id is not null and credential_state <> 'revoked';

create index if not exists smart_lock_ekey_grants_tenancy_idx
  on public.smart_lock_ekey_grants (tenancy_id, credential_state);

create index if not exists smart_lock_ekey_grants_tenant_idx
  on public.smart_lock_ekey_grants (tenant_profile_id, credential_state);

create index if not exists smart_lock_ekey_grants_device_idx
  on public.smart_lock_ekey_grants (device_id);

create index if not exists smart_lock_ekey_grants_company_idx
  on public.smart_lock_ekey_grants (company_id);

create index if not exists smart_lock_ekey_grants_property_idx
  on public.smart_lock_ekey_grants (property_id);

create index if not exists smart_lock_ekey_grants_room_idx
  on public.smart_lock_ekey_grants (room_id);

alter table public.smart_lock_ekey_grants enable row level security;

drop policy if exists "smart_lock_ekey_grants_select_allowed"
  on public.smart_lock_ekey_grants;

create policy "smart_lock_ekey_grants_select_allowed"
on public.smart_lock_ekey_grants
for select
to authenticated
using (
  tenant_profile_id = (select auth.uid())
  or public.current_profile_role() = 'super_admin'
);

revoke all on public.smart_lock_ekey_grants from public, anon, authenticated;
grant select on public.smart_lock_ekey_grants to authenticated;
grant all on public.smart_lock_ekey_grants to service_role;

comment on table public.smart_lock_ekey_grants is
  'TTLock app eKeys sent to tenants. Written only by the service role (server actions).';

alter table public.smart_meters
  add column if not exists power_control_reason text,
  add column if not exists power_controlled_at timestamptz,
  add column if not exists power_controlled_by uuid references auth.users(id) on delete set null;

alter table public.smart_meters
  drop constraint if exists smart_meters_power_control_reason_check;

alter table public.smart_meters
  add constraint smart_meters_power_control_reason_check
    check (power_control_reason is null or power_control_reason in ('staff', 'checkout', 'move_in'));

create index if not exists smart_meters_power_controlled_by_idx
  on public.smart_meters (power_controlled_by);

comment on column public.smart_meters.power_control_reason is
  'Why DEKEZ last switched the meter off (staff, checkout). Cleared when switched on.';
