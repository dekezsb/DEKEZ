-- Keep the active TTLock passcode available only to the assigned tenant and
-- Super Admin through the existing row-level access policy. The passcode is
-- cleared after revocation while the provider ID and timestamps remain for
-- the permanent audit trail.
alter table public.smart_lock_access_grants
  add column if not exists keyboard_password text,
  add column if not exists passcode_name text,
  add column if not exists provider_status jsonb not null default '{}'::jsonb,
  add column if not exists last_provider_sync_at timestamptz;

alter table public.smart_lock_access_grants
  drop constraint if exists smart_lock_active_credential_check;

alter table public.smart_lock_access_grants
  add constraint smart_lock_active_credential_check
  check (
    credential_state <> 'active'
    or (
      provider_keyboard_pwd_id is not null
      and keyboard_password is not null
      and length(keyboard_password) between 4 and 9
    )
  );

comment on column public.smart_lock_access_grants.keyboard_password is
  'Current tenant passcode. Cleared when access is revoked; protected by tenant/super-admin RLS.';

comment on column public.smart_lock_access_grants.provider_status is
  'Non-secret TTLock synchronization metadata retained for access auditing.';
