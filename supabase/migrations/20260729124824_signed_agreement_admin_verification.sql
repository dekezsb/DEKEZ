alter table public.tenancy_agreements
  add column if not exists admin_verified_at timestamptz,
  add column if not exists admin_verified_by uuid references auth.users(id) on delete set null;

create index if not exists tenancy_agreements_pending_admin_verification_idx
  on public.tenancy_agreements (signed_at desc)
  where signed_at is not null and admin_verified_at is null;

create table if not exists public.tenancy_agreement_verification_logs (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.tenancy_agreements(id) on delete restrict,
  action text not null check (action in ('verified')),
  performed_by uuid not null references auth.users(id) on delete restrict,
  performed_at timestamptz not null default now()
);

create index if not exists tenancy_agreement_verification_logs_agreement_idx
  on public.tenancy_agreement_verification_logs (agreement_id, performed_at desc);

alter table public.tenancy_agreement_verification_logs enable row level security;

drop policy if exists "tenancy_agreement_verification_logs_select_admin"
  on public.tenancy_agreement_verification_logs;
create policy "tenancy_agreement_verification_logs_select_admin"
on public.tenancy_agreement_verification_logs
for select
to authenticated
using (public.current_profile_role() in ('super_admin', 'admin'));

drop policy if exists "tenancy_agreement_verification_logs_insert_admin"
  on public.tenancy_agreement_verification_logs;
create policy "tenancy_agreement_verification_logs_insert_admin"
on public.tenancy_agreement_verification_logs
for insert
to authenticated
with check (
  public.current_profile_role() in ('super_admin', 'admin')
  and performed_by = (select auth.uid())
);

grant select, insert on public.tenancy_agreement_verification_logs to authenticated;
grant all on public.tenancy_agreement_verification_logs to service_role;
