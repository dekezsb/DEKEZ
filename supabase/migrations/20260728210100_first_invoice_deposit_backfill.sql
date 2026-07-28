with tenancy_first_invoices as (
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
      tenancy.contract_start,
      tenancy.start_date
    ) as first_invoice_date,
    greatest(coalesce(tenancy.deposit, 0), 0) as deposit_amount,
    coalesce(
      nullif(tenancy.monthly_rental, 0),
      tenancy.monthly_rent,
      0
    ) as monthly_rent
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
      tenancy.contract_start,
      tenancy.start_date
    ) <= current_date
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
  invoice_date,
  amount,
  deposit_amount,
  paid_amount,
  status,
  invoice_source,
  created_by
)
select
  first_invoice.organization_id,
  first_invoice.tenancy_id,
  first_invoice.portal_profile_id,
  first_invoice.tenant_record_id,
  first_invoice.property_id,
  first_invoice.unit_id,
  first_invoice.room_id,
  date_trunc('month', first_invoice.first_invoice_date)::date,
  first_invoice.first_invoice_date,
  first_invoice.first_invoice_date,
  first_invoice.monthly_rent,
  first_invoice.deposit_amount,
  0,
  'unpaid',
  'automatic',
  null
from tenancy_first_invoices first_invoice
where first_invoice.property_id is not null
  and not exists (
    select 1
    from public.rent_bills existing
    where existing.tenancy_id = first_invoice.tenancy_id
      and existing.bill_month =
        date_trunc('month', first_invoice.first_invoice_date)::date
  )
on conflict (tenancy_id, bill_month) do nothing;

with imported_first_invoices as (
  select
    record.id as tenant_record_id,
    record.property_id,
    record.unit_id,
    record.room_id,
    record.contract_start as first_invoice_date,
    greatest(coalesce(record.deposit, 0), 0) as deposit_amount,
    greatest(coalesce(record.monthly_rent, 0), 0) as monthly_rent
  from public.tenant_records record
  where record.tenancy_id is null
    and record.property_id is not null
    and record.room_id is not null
    and record.contract_start is not null
    and record.contract_start <= current_date
    and record.status <> 'cancelled'
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
  invoice_date,
  amount,
  deposit_amount,
  paid_amount,
  status,
  invoice_source,
  created_by
)
select
  null,
  null,
  null,
  first_invoice.tenant_record_id,
  first_invoice.property_id,
  first_invoice.unit_id,
  first_invoice.room_id,
  date_trunc('month', first_invoice.first_invoice_date)::date,
  first_invoice.first_invoice_date,
  first_invoice.first_invoice_date,
  first_invoice.monthly_rent,
  first_invoice.deposit_amount,
  0,
  'unpaid',
  'automatic',
  null
from imported_first_invoices first_invoice
where not exists (
  select 1
  from public.rent_bills existing
  where existing.tenant_record_id = first_invoice.tenant_record_id
    and existing.bill_month =
      date_trunc('month', first_invoice.first_invoice_date)::date
)
on conflict (tenant_record_id, bill_month)
where tenant_record_id is not null
do nothing;

alter table public.rent_bills
  disable trigger rent_bills_invoice_metadata;

with invoice_terms as (
  select
    tenancy.id as tenancy_id,
    coalesce(
      tenancy.check_in_date,
      tenancy.tenancy_start_date,
      tenancy.contract_start,
      tenancy.start_date
    ) as first_invoice_date,
    greatest(coalesce(tenancy.deposit, 0), 0) as deposit_amount
  from public.tenancies tenancy
)
update public.rent_bills bill
set
  deposit_amount = term.deposit_amount,
  due_date = term.first_invoice_date,
  invoice_date = term.first_invoice_date,
  issued_at = term.first_invoice_date::timestamp at time zone 'Asia/Kuala_Lumpur',
  retain_until = (term.first_invoice_date + interval '7 years')::date,
  updated_at = now()
from invoice_terms term
where bill.tenancy_id = term.tenancy_id
  and bill.status::text <> 'cancelled'
  and bill.bill_month = date_trunc('month', term.first_invoice_date)::date;

with invoice_terms as (
  select
    record.id as tenant_record_id,
    record.contract_start as first_invoice_date,
    greatest(coalesce(record.deposit, 0), 0) as deposit_amount
  from public.tenant_records record
  where record.tenancy_id is null
    and record.contract_start is not null
)
update public.rent_bills bill
set
  deposit_amount = term.deposit_amount,
  due_date = term.first_invoice_date,
  invoice_date = term.first_invoice_date,
  issued_at = term.first_invoice_date::timestamp at time zone 'Asia/Kuala_Lumpur',
  retain_until = (term.first_invoice_date + interval '7 years')::date,
  updated_at = now()
from invoice_terms term
where bill.tenancy_id is null
  and bill.tenant_record_id = term.tenant_record_id
  and bill.status::text <> 'cancelled'
  and bill.bill_month = date_trunc('month', term.first_invoice_date)::date;

alter table public.rent_bills
  enable trigger rent_bills_invoice_metadata;
