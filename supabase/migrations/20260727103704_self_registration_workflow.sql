alter table public.profiles
  add column if not exists requested_role text,
  add column if not exists identity_type text,
  add column if not exists identity_number text,
  add column if not exists company_name text,
  add column if not exists company_details text,
  add column if not exists registration_completed_at timestamptz;

update public.profiles
set registration_completed_at = coalesce(registration_completed_at, created_at)
where registration_completed_at is null;

alter table public.profiles
  drop constraint if exists profiles_requested_role_check;

alter table public.profiles
  add constraint profiles_requested_role_check
  check (requested_role is null or requested_role in ('owner', 'tenant'));

alter table public.profiles
  drop constraint if exists profiles_identity_type_check;

alter table public.profiles
  add constraint profiles_identity_type_check
  check (identity_type is null or identity_type in ('ic', 'passport'));

create index if not exists profiles_requested_role_status_idx
  on public.profiles (requested_role, registration_status, created_at desc);

create table if not exists public.profile_documents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  document_type text not null,
  file_path text not null unique,
  file_name text,
  content_type text,
  verification_status text not null default 'pending_verification',
  uploaded_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  constraint profile_documents_type_check
    check (
      document_type in (
        'ic_front',
        'ic_back',
        'passport_photo_page',
        'trading_license',
        'company_document'
      )
    ),
  constraint profile_documents_verification_status_check
    check (
      verification_status in (
        'pending_verification',
        'verified',
        'rejected',
        'more_information_required'
      )
    )
);

create index if not exists profile_documents_profile_idx
  on public.profile_documents (profile_id, uploaded_at desc);

alter table public.profile_documents enable row level security;

drop policy if exists "profile_documents_select_allowed"
  on public.profile_documents;
create policy "profile_documents_select_allowed"
on public.profile_documents
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or public.is_platform_admin()
);

drop policy if exists "profile_documents_manage_admin"
  on public.profile_documents;
create policy "profile_documents_manage_admin"
on public.profile_documents
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

grant select on public.profile_documents to authenticated;
grant select, insert, update, delete on public.profile_documents to service_role;

create table if not exists public.auth_login_rate_limits (
  phone_hash text primary key,
  failed_attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now(),
  constraint auth_login_rate_limits_failed_attempts_check
    check (failed_attempts >= 0)
);

alter table public.auth_login_rate_limits enable row level security;

revoke all on public.auth_login_rate_limits from anon, authenticated;
grant select, insert, update, delete
  on public.auth_login_rate_limits
  to service_role;

alter table public.tenant_applications
  drop constraint if exists tenant_applications_submission_source_check;

alter table public.tenant_applications
  add constraint tenant_applications_submission_source_check
  check (
    submission_source in (
      'tenant_portal',
      'admin_assisted',
      'self_registration'
    )
  );

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
where id in ('tenant-documents', 'payment-receipts');
