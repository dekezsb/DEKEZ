-- Every active BDS tenancy will eventually receive two TTLock credentials:
-- one for the shared main entrance and one for the assigned room lock.
alter table public.smart_lock_devices
  add column if not exists access_scope text not null default 'room_entry';

update public.smart_lock_devices
set
  access_scope = case
    when onboarding_key = 'bds-main-office' then 'property_entry'
    else 'room_entry'
  end,
  updated_at = now()
where provider = 'ttlock';

alter table public.smart_lock_devices
  drop constraint if exists smart_lock_access_scope_check;

alter table public.smart_lock_devices
  add constraint smart_lock_access_scope_check
  check (access_scope in ('property_entry', 'room_entry'));

create table if not exists public.smart_lock_access_grants (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.smart_lock_devices(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  room_id uuid references public.rooms(id) on delete restrict,
  tenancy_id uuid not null references public.tenancies(id) on delete restrict,
  tenant_profile_id uuid not null references auth.users(id) on delete restrict,
  access_scope text not null,
  provider_keyboard_pwd_id bigint,
  credential_state text not null default 'pending_generation',
  valid_from timestamptz not null,
  valid_until timestamptz not null,
  activated_at timestamptz,
  revoke_requested_at timestamptz,
  revoked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_lock_grant_scope_check
    check (access_scope in ('property_entry', 'room_entry')),
  constraint smart_lock_grant_state_check
    check (
      credential_state in (
        'pending_generation',
        'active',
        'revoke_pending',
        'revoked',
        'error'
      )
    ),
  constraint smart_lock_grant_valid_period_check check (valid_until > valid_from),
  constraint smart_lock_room_scope_check
    check (access_scope <> 'room_entry' or room_id is not null),
  constraint smart_lock_revoked_check
    check (credential_state <> 'revoked' or revoked_at is not null)
);

create unique index if not exists smart_lock_one_open_grant_idx
  on public.smart_lock_access_grants (device_id, tenancy_id)
  where credential_state in ('pending_generation', 'active', 'revoke_pending');

create unique index if not exists smart_lock_provider_pwd_unique_idx
  on public.smart_lock_access_grants (device_id, provider_keyboard_pwd_id)
  where provider_keyboard_pwd_id is not null;

create index if not exists smart_lock_grants_tenancy_idx
  on public.smart_lock_access_grants (tenancy_id, credential_state);

create index if not exists smart_lock_grants_tenant_idx
  on public.smart_lock_access_grants (tenant_profile_id, credential_state);

alter table public.smart_lock_access_grants enable row level security;

drop policy if exists "smart_lock_grants_select_allowed"
  on public.smart_lock_access_grants;

create policy "smart_lock_grants_select_allowed"
on public.smart_lock_access_grants
for select
to authenticated
using (
  tenant_profile_id = (select auth.uid())
  or public.current_profile_role() = 'super_admin'
);

revoke all on public.smart_lock_access_grants from public, anon, authenticated;
grant select on public.smart_lock_access_grants to authenticated;
grant all on public.smart_lock_access_grants to service_role;
