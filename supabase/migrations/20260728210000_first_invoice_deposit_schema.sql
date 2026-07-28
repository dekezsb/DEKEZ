alter table public.rent_bills
  add column if not exists deposit_amount numeric(12, 2) not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.rent_bills'::regclass
      and conname = 'rent_bills_deposit_amount_check'
  ) then
    alter table public.rent_bills
      add constraint rent_bills_deposit_amount_check
      check (deposit_amount >= 0);
  end if;
end $$;

create or replace function public.set_first_rental_invoice_deposit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  first_invoice_date date;
  required_deposit numeric(12, 2);
begin
  if new.tenancy_id is not null then
    select
      coalesce(
        tenancy.check_in_date,
        tenancy.tenancy_start_date,
        tenancy.contract_start,
        tenancy.start_date
      ),
      greatest(coalesce(tenancy.deposit, 0), 0)
    into first_invoice_date, required_deposit
    from public.tenancies tenancy
    where tenancy.id = new.tenancy_id;
  elsif new.tenant_record_id is not null then
    select
      record.contract_start,
      greatest(coalesce(record.deposit, 0), 0)
    into first_invoice_date, required_deposit
    from public.tenant_records record
    where record.id = new.tenant_record_id;
  end if;

  if first_invoice_date is not null
    and new.bill_month = date_trunc('month', first_invoice_date)::date
    and new.status::text <> 'cancelled'
  then
    new.deposit_amount := coalesce(required_deposit, 0);

    if new.invoice_source = 'automatic' then
      new.due_date := first_invoice_date;
      new.invoice_date := first_invoice_date;
    end if;
  else
    new.deposit_amount := 0;
  end if;

  return new;
end;
$$;

drop trigger if exists rent_bills_first_invoice_deposit
  on public.rent_bills;
create trigger rent_bills_first_invoice_deposit
before insert or update of tenancy_id, tenant_record_id, bill_month, invoice_source
on public.rent_bills
for each row
execute function public.set_first_rental_invoice_deposit();

revoke all on function public.set_first_rental_invoice_deposit()
  from public, anon, authenticated;
grant execute on function public.set_first_rental_invoice_deposit()
  to service_role;

comment on column public.rent_bills.deposit_amount is
  'Snapshot of the tenancy deposit charged once on the first invoice only.';
