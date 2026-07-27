-- Per-user module access, managed only by Super Admin.
create table if not exists public.user_module_permissions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  module_key text not null check (
    module_key in (
      'dashboard',
      'admin_setup',
      'properties',
      'verification',
      'payments',
      'rent_due_tracker',
      'tenancy_agreements',
      'utility_bills',
      'expenses',
      'maintenance',
      'claims',
      'reports',
      'settings',
      'onboarding'
    )
  ),
  access_level text not null check (
    access_level in ('none', 'view', 'manage')
  ),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, module_key)
);

create index if not exists user_module_permissions_profile_id_idx
  on public.user_module_permissions (profile_id);

alter table public.user_module_permissions enable row level security;

grant select, insert, update, delete
  on public.user_module_permissions
  to authenticated;

grant all
  on public.user_module_permissions
  to service_role;

drop policy if exists "users view own module permissions"
  on public.user_module_permissions;
create policy "users view own module permissions"
on public.user_module_permissions
for select
to authenticated
using (
  profile_id = (select auth.uid())
  or public.current_profile_role() = 'super_admin'
);

drop policy if exists "super admin inserts module permissions"
  on public.user_module_permissions;
create policy "super admin inserts module permissions"
on public.user_module_permissions
for insert
to authenticated
with check (public.current_profile_role() = 'super_admin');

drop policy if exists "super admin updates module permissions"
  on public.user_module_permissions;
create policy "super admin updates module permissions"
on public.user_module_permissions
for update
to authenticated
using (public.current_profile_role() = 'super_admin')
with check (public.current_profile_role() = 'super_admin');

drop policy if exists "super admin deletes module permissions"
  on public.user_module_permissions;
create policy "super admin deletes module permissions"
on public.user_module_permissions
for delete
to authenticated
using (public.current_profile_role() = 'super_admin');
