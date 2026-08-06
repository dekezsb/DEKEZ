create or replace function public.apply_rental_model_to_application()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  selected_model text;
begin
  if tg_op = 'UPDATE' then
    selected_model := old.rental_model;
  else
    select p.rental_model into selected_model
    from public.properties p
    where p.id = new.property_id;
  end if;

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

create or replace function public.enforce_monthly_stay_tenancy()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  selected_model text;
  application_ready boolean;
begin
  if tg_op = 'UPDATE' then
    selected_model := old.rental_model;
    application_ready := true;
    new.tenant_application_id := old.tenant_application_id;
  elsif new.tenant_application_id is not null then
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
before insert or update of deposit, end_date, contract_end, tenancy_end_date,
  contract_duration_months, tenant_application_id, rental_model
on public.tenancies
for each row execute function public.enforce_monthly_stay_tenancy();
