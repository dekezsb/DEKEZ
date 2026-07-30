create table if not exists public.tenancy_rent_adjustments (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  payment_submission_id uuid not null
    references public.payment_submissions(id) on delete restrict,
  agreement_id uuid references public.tenancy_agreements(id) on delete set null,
  old_monthly_rent numeric(12, 2) not null check (old_monthly_rent >= 0),
  new_monthly_rent numeric(12, 2) not null check (new_monthly_rent > 0),
  effective_month date not null,
  change_type text not null check (change_type in ('increase', 'discount')),
  reason text not null check (length(trim(reason)) > 0),
  agreement_sync_status text not null default 'not_required'
    check (
      agreement_sync_status in (
        'updated_unsigned',
        'created_amendment',
        'signed_history_preserved',
        'not_found',
        'not_required'
      )
    ),
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (payment_submission_id)
);

create index if not exists tenancy_rent_adjustments_tenancy_effective_idx
  on public.tenancy_rent_adjustments (tenancy_id, effective_month desc);

alter table public.tenancy_rent_adjustments enable row level security;

drop policy if exists "tenancy_rent_adjustments_select_admin"
  on public.tenancy_rent_adjustments;
create policy "tenancy_rent_adjustments_select_admin"
on public.tenancy_rent_adjustments
for select
to authenticated
using ((select public.is_platform_admin()));

grant select on public.tenancy_rent_adjustments to authenticated;
grant all on public.tenancy_rent_adjustments to service_role;
