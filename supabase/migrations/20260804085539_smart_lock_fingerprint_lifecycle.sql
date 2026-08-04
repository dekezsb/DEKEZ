-- Fingerprints are enrolled physically at a TTLock device. DEKEZ stores only
-- the provider record identifiers and access lifecycle metadata; it never
-- stores a biometric image or fingerprint template.
create table if not exists public.smart_lock_fingerprint_grants (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.smart_lock_devices(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete restrict,
  room_id uuid references public.rooms(id) on delete restrict,
  tenancy_id uuid not null references public.tenancies(id) on delete restrict,
  tenant_profile_id uuid not null references auth.users(id) on delete restrict,
  access_scope text not null,
  provider_fingerprint_id bigint,
  provider_fingerprint_number text,
  fingerprint_name text,
  enrollment_code text not null,
  credential_state text not null default 'pending_enrollment',
  valid_from timestamptz,
  valid_until timestamptz,
  invitation_sent_at timestamptz,
  enrolled_at timestamptz,
  suspended_at timestamptz,
  reactivated_at timestamptz,
  revoke_requested_at timestamptz,
  revoked_at timestamptz,
  last_extension_reference text,
  last_error text,
  provider_status jsonb not null default '{}'::jsonb,
  last_provider_sync_at timestamptz,
  retain_until date not null default (
    ((now() at time zone 'Asia/Kuala_Lumpur')::date + interval '7 years')::date
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_lock_fingerprint_scope_check
    check (access_scope in ('property_entry', 'room_entry')),
  constraint smart_lock_fingerprint_room_scope_check
    check (access_scope <> 'room_entry' or room_id is not null),
  constraint smart_lock_fingerprint_state_check
    check (
      credential_state in (
        'pending_enrollment',
        'active',
        'suspension_due',
        'suspended',
        'revoke_pending',
        'revoked',
        'error'
      )
    ),
  constraint smart_lock_fingerprint_active_data_check
    check (
      credential_state not in ('active', 'suspension_due', 'suspended')
      or (
        provider_fingerprint_id is not null
        and provider_fingerprint_number is not null
        and valid_from is not null
        and valid_until is not null
      )
    ),
  constraint smart_lock_fingerprint_valid_period_check
    check (valid_from is null or valid_until is null or valid_until > valid_from),
  constraint smart_lock_fingerprint_revoked_check
    check (credential_state <> 'revoked' or revoked_at is not null)
);

create unique index if not exists smart_lock_one_open_fingerprint_grant_idx
  on public.smart_lock_fingerprint_grants (device_id, tenancy_id)
  where credential_state in (
    'pending_enrollment',
    'active',
    'suspension_due',
    'suspended',
    'revoke_pending'
  );

create unique index if not exists smart_lock_open_provider_fingerprint_idx
  on public.smart_lock_fingerprint_grants (device_id, provider_fingerprint_id)
  where provider_fingerprint_id is not null
    and credential_state <> 'revoked';

create index if not exists smart_lock_fingerprint_tenancy_idx
  on public.smart_lock_fingerprint_grants (tenancy_id, credential_state);

create index if not exists smart_lock_fingerprint_policy_idx
  on public.smart_lock_fingerprint_grants (credential_state, valid_until)
  where credential_state in ('active', 'suspension_due', 'suspended');

create table if not exists public.smart_lock_fingerprint_audit_logs (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.smart_lock_fingerprint_grants(id) on delete restrict,
  device_id uuid not null references public.smart_lock_devices(id) on delete restrict,
  tenancy_id uuid not null references public.tenancies(id) on delete restrict,
  payment_submission_id uuid references public.payment_submissions(id) on delete restrict,
  action text not null,
  performed_by uuid references auth.users(id) on delete restrict,
  old_state text,
  new_state text,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  retain_until date not null default (
    ((now() at time zone 'Asia/Kuala_Lumpur')::date + interval '7 years')::date
  ),
  constraint smart_lock_fingerprint_audit_action_check
    check (
      action in (
        'enrollment_invited',
        'fingerprint_assigned',
        'access_extended',
        'suspension_due',
        'access_suspended',
        'access_reactivated',
        'checkout_revocation_requested',
        'checkout_revoked',
        'provider_error'
      )
    )
);

create unique index if not exists smart_lock_fingerprint_payment_extension_unique_idx
  on public.smart_lock_fingerprint_audit_logs (
    grant_id,
    payment_submission_id,
    action
  )
  where payment_submission_id is not null
    and action in ('access_extended', 'access_reactivated');

create index if not exists smart_lock_fingerprint_audit_tenancy_time_idx
  on public.smart_lock_fingerprint_audit_logs (tenancy_id, occurred_at desc);

alter table public.smart_lock_fingerprint_grants enable row level security;
alter table public.smart_lock_fingerprint_audit_logs enable row level security;

drop policy if exists "smart_lock_fingerprint_grants_select_allowed"
  on public.smart_lock_fingerprint_grants;

create policy "smart_lock_fingerprint_grants_select_allowed"
on public.smart_lock_fingerprint_grants
for select
to authenticated
using (
  tenant_profile_id = (select auth.uid())
  or public.current_profile_role() = 'super_admin'
);

drop policy if exists "smart_lock_fingerprint_audit_super_admin_select"
  on public.smart_lock_fingerprint_audit_logs;

create policy "smart_lock_fingerprint_audit_super_admin_select"
on public.smart_lock_fingerprint_audit_logs
for select
to authenticated
using (public.current_profile_role() = 'super_admin');

revoke all on public.smart_lock_fingerprint_grants from public, anon, authenticated;
grant select on public.smart_lock_fingerprint_grants to authenticated;
grant all on public.smart_lock_fingerprint_grants to service_role;

revoke all on public.smart_lock_fingerprint_audit_logs from public, anon, authenticated;
grant select on public.smart_lock_fingerprint_audit_logs to authenticated;
grant all on public.smart_lock_fingerprint_audit_logs to service_role;

comment on table public.smart_lock_fingerprint_grants is
  'TTLock fingerprint lifecycle metadata only. Biometric images and templates are never stored.';

comment on column public.smart_lock_fingerprint_grants.provider_fingerprint_number is
  'Provider slot/code returned by TTLock, not a biometric fingerprint template.';
