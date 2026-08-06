alter table public.properties
  add column if not exists rental_model text not null default 'tenancy';

alter table public.tenant_applications
  add column if not exists rental_model text not null default 'tenancy';

alter table public.tenancies
  add column if not exists rental_model text not null default 'tenancy',
  add column if not exists tenant_application_id uuid references public.tenant_applications(id) on delete restrict;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'properties_rental_model_check'
  ) then
    alter table public.properties add constraint properties_rental_model_check
      check (rental_model in ('tenancy', 'monthly_stay'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'tenant_applications_rental_model_check'
  ) then
    alter table public.tenant_applications add constraint tenant_applications_rental_model_check
      check (rental_model in ('tenancy', 'monthly_stay'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'tenancies_rental_model_check'
  ) then
    alter table public.tenancies add constraint tenancies_rental_model_check
      check (rental_model in ('tenancy', 'monthly_stay'));
  end if;
end $$;

create unique index if not exists tenancies_tenant_application_unique
  on public.tenancies (tenant_application_id)
  where tenant_application_id is not null;

comment on column public.properties.rental_model is
  'tenancy uses a fixed tenancy agreement; monthly_stay is a rolling, deposit-free monthly occupancy.';
comment on column public.tenant_applications.rental_model is
  'Snapshot of the property rental model when the application was submitted.';
comment on column public.tenancies.rental_model is
  'Snapshot of the rules used when this occupancy started; existing tenancies remain grandfathered.';

create or replace function public.apply_rental_model_to_application()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  selected_model text;
begin
  select p.rental_model into selected_model
  from public.properties p
  where p.id = new.property_id;

  new.rental_model := coalesce(selected_model, 'tenancy');
  if new.rental_model = 'monthly_stay' then
    new.deposit := 0;
    new.utility_deposit := 0;
    new.contract_duration_months := 1;
    new.proposed_end_date := null;
  end if;
  return new;
end;
$$;

revoke all on function public.apply_rental_model_to_application() from public, anon, authenticated;

drop trigger if exists set_application_rental_model on public.tenant_applications;
create trigger set_application_rental_model
before insert or update of property_id, deposit, utility_deposit, contract_duration_months, proposed_end_date
on public.tenant_applications
for each row execute function public.apply_rental_model_to_application();

create or replace function public.enforce_monthly_stay_tenancy()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  selected_model text;
  application_ready boolean;
begin
  if new.tenant_application_id is not null then
    select a.rental_model,
      a.verification_status = 'verified'
      and a.payment_status = 'verified'
      and a.property_id = new.property_id
      and a.room_id = new.room_id
    into selected_model, application_ready
    from public.tenant_applications a
    where a.id = new.tenant_application_id;
  else
    select p.rental_model, false into selected_model, application_ready
    from public.properties p
    where p.id = new.property_id;
  end if;

  new.rental_model := coalesce(selected_model, 'tenancy');
  if new.rental_model = 'monthly_stay' then
    if new.tenant_application_id is null or not coalesce(application_ready, false) then
      raise exception 'Monthly stay requires a verified registration and verified first payment.';
    end if;
    new.deposit := 0;
    new.end_date := null;
    new.contract_end := null;
    new.tenancy_end_date := null;
    new.contract_duration_months := null;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_monthly_stay_tenancy() from public, anon, authenticated;

drop trigger if exists enforce_tenancy_rental_model on public.tenancies;
create trigger enforce_tenancy_rental_model
before insert on public.tenancies
for each row execute function public.enforce_monthly_stay_tenancy();

update public.properties
set rental_model = 'monthly_stay', updated_at = now()
where property_code = 'SLS';
