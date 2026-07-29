-- Some historical check-in invoices were automatically cancelled by the old
-- recurring-billing cleanup. Restore only untouched automatic invoices:
-- no payment, no explicit removal audit, and exactly the check-in month.
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
  status = 'unpaid',
  deposit_amount = term.deposit_amount,
  due_date = term.first_invoice_date,
  invoice_date = term.first_invoice_date,
  retain_until = greatest(
    bill.retain_until,
    (term.first_invoice_date + interval '7 years')::date
  ),
  notes = coalesce(
    bill.notes,
    'Restored automatic check-in-month invoice after billing correction.'
  ),
  updated_at = now()
from invoice_terms term
where bill.tenancy_id = term.tenancy_id
  and term.first_invoice_date is not null
  and bill.bill_month = date_trunc('month', term.first_invoice_date)::date
  and bill.status::text = 'cancelled'
  and bill.invoice_source = 'automatic'
  and bill.paid_amount = 0
  and bill.removed_at is null
  and bill.removed_by is null
  and bill.removal_reason is null;

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
  status = 'unpaid',
  deposit_amount = term.deposit_amount,
  due_date = term.first_invoice_date,
  invoice_date = term.first_invoice_date,
  retain_until = greatest(
    bill.retain_until,
    (term.first_invoice_date + interval '7 years')::date
  ),
  notes = coalesce(
    bill.notes,
    'Restored automatic check-in-month invoice after billing correction.'
  ),
  updated_at = now()
from invoice_terms term
where bill.tenancy_id is null
  and bill.tenant_record_id = term.tenant_record_id
  and bill.bill_month = date_trunc('month', term.first_invoice_date)::date
  and bill.status::text = 'cancelled'
  and bill.invoice_source = 'automatic'
  and bill.paid_amount = 0
  and bill.removed_at is null
  and bill.removed_by is null
  and bill.removal_reason is null;
