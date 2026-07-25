alter table public.tenancies
  add column if not exists rent_due_day integer,
  add column if not exists check_in_date date,
  add column if not exists checkout_date date,
  add column if not exists billing_status text not null default 'active';

update public.tenancies
set rent_due_day = coalesce(rent_due_day, due_day, extract(day from coalesce(check_in_date, tenancy_start_date, contract_start))::integer),
    check_in_date = coalesce(check_in_date, tenancy_start_date, contract_start),
    billing_status = coalesce(nullif(billing_status, ''), 'active')
where rent_due_day is null
   or check_in_date is null
   or billing_status is null
   or billing_status = '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tenancies_rent_due_day_check'
  ) then
    alter table public.tenancies
      add constraint tenancies_rent_due_day_check check (rent_due_day between 1 and 31) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'tenancies_billing_status_check'
  ) then
    alter table public.tenancies
      add constraint tenancies_billing_status_check check (billing_status in ('active', 'paused', 'terminated', 'completed')) not valid;
  end if;
end $$;

alter table public.rent_bills
  add column if not exists tenant_record_id uuid references public.tenant_records(id) on delete set null;

alter table public.rent_bills
  alter column tenant_id drop not null,
  alter column tenancy_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'rent_bills_has_tenant_source'
  ) then
    alter table public.rent_bills
      add constraint rent_bills_has_tenant_source check (tenant_id is not null or tenant_record_id is not null) not valid;
  end if;
end $$;

create unique index if not exists rent_bills_tenant_record_month_unique
  on public.rent_bills (tenant_record_id, bill_month)
  where tenant_record_id is not null;
