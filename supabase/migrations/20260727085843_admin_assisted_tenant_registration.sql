alter table public.tenant_applications
  alter column tenant_id drop not null;

alter table public.tenant_applications
  add column if not exists submitted_by uuid references auth.users(id) on delete set null,
  add column if not exists submission_source text not null default 'tenant_portal',
  add column if not exists identity_type text;

alter table public.tenant_applications
  drop constraint if exists tenant_applications_submission_source_check;

alter table public.tenant_applications
  add constraint tenant_applications_submission_source_check
  check (submission_source in ('tenant_portal', 'admin_assisted'));

alter table public.tenant_applications
  drop constraint if exists tenant_applications_identity_type_check;

alter table public.tenant_applications
  add constraint tenant_applications_identity_type_check
  check (identity_type is null or identity_type in ('ic', 'passport'));

alter table public.tenant_verifications
  alter column tenant_id drop not null;

create index if not exists tenant_applications_submitted_by_idx
  on public.tenant_applications (submitted_by);

create unique index if not exists tenant_applications_one_active_room_idx
  on public.tenant_applications (room_id)
  where status in ('submitted', 'pending_verification', 'approved');

drop policy if exists "tenant_applications_insert_admin" on public.tenant_applications;
create policy "tenant_applications_insert_admin"
on public.tenant_applications
for insert
to authenticated
with check (
  submitted_by = (select auth.uid())
  and submission_source = 'admin_assisted'
  and public.can_manage_property(property_id)
);
