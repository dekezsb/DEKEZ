create or replace function public.set_first_rental_invoice_deposit()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  first_invoice_date date;
  required_deposit numeric(12, 2);
begin
  -- Once an invoice has been issued, its deposit is an accounting snapshot.
  -- Later tenancy-rate or requirement changes must not rewrite that history.
  if tg_op = 'UPDATE' and coalesce(old.status::text, '') <> 'draft' then
    new.deposit_amount := old.deposit_amount;
    return new;
  end if;

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
$function$;
