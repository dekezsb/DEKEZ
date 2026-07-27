alter table public.rent_bills
  add column if not exists invoice_number text,
  add column if not exists issued_at timestamptz not null default now(),
  add column if not exists retain_until date;

create sequence if not exists public.rental_invoice_number_seq;

with numbered as (
  select
    id,
    row_number() over (
      order by coalesce(due_date, bill_month), created_at, id
    ) as running_number
  from public.rent_bills
  where invoice_number is null
)
update public.rent_bills bills
set
  invoice_number =
    'DINV-' ||
    extract(year from bills.bill_month)::integer::text ||
    '-' ||
    lpad(numbered.running_number::text, 4, '0'),
  issued_at = (
    coalesce(bills.due_date, bills.bill_month)::timestamp
    at time zone 'Asia/Kuala_Lumpur'
  ),
  retain_until = coalesce(
    bills.retain_until,
    (coalesce(bills.due_date, bills.bill_month) + interval '7 years')::date
  )
from numbered
where numbered.id = bills.id;

select setval(
  'public.rental_invoice_number_seq',
  greatest(
    coalesce(
      (
        select max(
          nullif(regexp_replace(invoice_number, '^.*-', ''), '')::bigint
        )
        from public.rent_bills
        where invoice_number ~ '^DINV-[0-9]{4}-[0-9]+$'
      ),
      0
    ),
    1
  ),
  exists (
    select 1
    from public.rent_bills
    where invoice_number ~ '^DINV-[0-9]{4}-[0-9]+$'
  )
);

create or replace function public.set_rental_invoice_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  running_number bigint;
begin
  if tg_op = 'UPDATE' then
    new.invoice_number := old.invoice_number;
    new.issued_at := old.issued_at;
    new.retain_until := greatest(old.retain_until, new.retain_until);
    return new;
  end if;

  if new.invoice_number is null or btrim(new.invoice_number) = '' then
    running_number := nextval('public.rental_invoice_number_seq');
    new.invoice_number :=
      'DINV-' ||
      extract(year from new.bill_month)::integer::text ||
      '-' ||
      lpad(running_number::text, 4, '0');
  end if;

  new.issued_at := (
    coalesce(new.due_date, new.bill_month)::timestamp
    at time zone 'Asia/Kuala_Lumpur'
  );
  new.retain_until := coalesce(
    new.retain_until,
    (coalesce(new.due_date, new.bill_month) + interval '7 years')::date
  );
  return new;
end;
$$;

drop trigger if exists rent_bills_invoice_metadata on public.rent_bills;
create trigger rent_bills_invoice_metadata
before insert or update of bill_month, invoice_number, retain_until
on public.rent_bills
for each row
execute function public.set_rental_invoice_metadata();

update public.rent_bills
set retain_until = (
  coalesce(due_date, bill_month) + interval '7 years'
)::date
where retain_until is null;

alter table public.rent_bills
  alter column invoice_number set not null,
  alter column retain_until set not null;

create unique index if not exists rent_bills_invoice_number_unique
  on public.rent_bills (invoice_number);

grant usage, select on sequence public.rental_invoice_number_seq
  to authenticated, service_role;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.rent_bills'::regclass
      and conname = 'rent_bills_has_tenant_source'
  ) then
    alter table public.rent_bills
      drop constraint rent_bills_has_tenant_source;
  end if;

  alter table public.rent_bills
    add constraint rent_bills_has_tenant_source
    check (
      tenancy_id is not null
      or tenant_id is not null
      or tenant_record_id is not null
    ) not valid;
end
$$;

create or replace function public.prevent_rental_invoice_early_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.retain_until >= current_date then
    raise exception
      'Rental invoice % must be retained until %.',
      old.invoice_number,
      old.retain_until;
  end if;
  return old;
end;
$$;

drop trigger if exists rent_bills_prevent_early_delete on public.rent_bills;
create trigger rent_bills_prevent_early_delete
before delete on public.rent_bills
for each row
execute function public.prevent_rental_invoice_early_delete();

with eligible_tenancies as (
  select
    tenancy.id as tenancy_id,
    tenancy.organization_id,
    tenancy.property_id,
    tenancy.unit_id,
    tenancy.room_id,
    tenant.profile_id as portal_profile_id,
    tenant_record.id as tenant_record_id,
    coalesce(
      tenancy.check_in_date,
      tenancy.tenancy_start_date,
      tenancy.contract_start
    ) as check_in_date,
    coalesce(
      tenancy.checkout_date,
      tenancy.tenancy_end_date,
      tenancy.contract_end
    ) as tenancy_end_date,
    coalesce(
      tenancy.rent_due_day,
      tenancy.due_day,
      extract(
        day from coalesce(
          tenancy.check_in_date,
          tenancy.tenancy_start_date,
          tenancy.contract_start
        )
      )::integer
    ) as due_day,
    coalesce(tenancy.monthly_rental, tenancy.monthly_rent, 0) as monthly_rent
  from public.tenancies tenancy
  join public.tenants tenant on tenant.id = tenancy.tenant_id
  left join lateral (
    select record.id
    from public.tenant_records record
    where record.tenancy_id = tenancy.id
    order by record.updated_at desc nulls last, record.created_at desc
    limit 1
  ) tenant_record on true
  where tenancy.status in ('active', 'ended')
    and coalesce(tenancy.billing_status, 'active') in ('active', 'completed')
    and coalesce(
      tenancy.check_in_date,
      tenancy.tenancy_start_date,
      tenancy.contract_start
    ) is not null
    and tenancy.status <> 'cancelled'
),
eligible_months as (
  select
    tenancy.*,
    month_start::date as bill_month
  from eligible_tenancies tenancy
  cross join lateral generate_series(
    date_trunc('month', tenancy.check_in_date)::date,
    least(
      date_trunc('month', current_date)::date,
      date_trunc(
        'month',
        coalesce(tenancy.tenancy_end_date, current_date)
      )::date
    ),
    interval '1 month'
  ) month_start
  where tenancy.check_in_date <= current_date
    and (
      tenancy.tenancy_end_date is null
      or tenancy.tenancy_end_date >= tenancy.check_in_date
    )
),
prepared_invoices as (
  select
    month.*,
    greatest(
      month.check_in_date,
      (
        month.bill_month +
        (
          least(
            month.due_day,
            extract(
              day from (
                month.bill_month +
                interval '1 month - 1 day'
              )
            )::integer
          ) - 1
        ) * interval '1 day'
      )::date
    ) as invoice_due_date
  from eligible_months month
)
insert into public.rent_bills (
  organization_id,
  tenancy_id,
  tenant_id,
  tenant_record_id,
  property_id,
  unit_id,
  room_id,
  bill_month,
  due_date,
  amount,
  paid_amount,
  status,
  created_by
)
select
  invoice.organization_id,
  invoice.tenancy_id,
  invoice.portal_profile_id,
  invoice.tenant_record_id,
  invoice.property_id,
  invoice.unit_id,
  invoice.room_id,
  invoice.bill_month,
  invoice.invoice_due_date,
  invoice.monthly_rent,
  0,
  'unpaid',
  null
from prepared_invoices invoice
where not exists (
  select 1
  from public.rent_bills existing
  where existing.tenancy_id = invoice.tenancy_id
    and existing.bill_month = invoice.bill_month
)
on conflict (tenancy_id, bill_month) do nothing;
