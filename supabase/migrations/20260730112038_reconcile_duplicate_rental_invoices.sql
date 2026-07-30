with duplicate_legacy_invoices as (
  select
    legacy.id,
    canonical.invoice_number as canonical_invoice_number
  from public.rent_bills as legacy
  join public.tenant_records as tenant_record
    on tenant_record.id = legacy.tenant_record_id
  join public.rent_bills as canonical
    on canonical.room_id = legacy.room_id
    and canonical.bill_month = legacy.bill_month
    and canonical.tenancy_id is not null
    and canonical.id <> legacy.id
    and canonical.removed_at is null
    and canonical.status not in ('cancelled', 'waived')
  join public.tenancies as tenancy
    on tenancy.id = canonical.tenancy_id
    and tenancy.status = 'active'
    and tenancy.checkout_date is null
  join public.tenants as tenant
    on tenant.id = tenancy.tenant_id
  where legacy.tenancy_id is null
    and legacy.tenant_record_id is not null
    and legacy.removed_at is null
    and legacy.status not in ('cancelled', 'waived')
    and lower(trim(tenant_record.full_name)) = lower(trim(tenant.full_name))
    and legacy.amount = canonical.amount
    and legacy.deposit_amount = canonical.deposit_amount
    and not exists (
      select 1
      from public.payment_submissions
      where rent_bill_id = legacy.id
    )
    and not exists (
      select 1
      from public.payments
      where rent_bill_id = legacy.id
    )
    and not exists (
      select 1
      from public.rent_bill_audit_logs
      where bill_id = legacy.id
    )
)
update public.rent_bills as invoice
set
  status = 'cancelled',
  removed_at = now(),
  removal_reason =
    'Duplicate legacy invoice; replaced by active-tenancy invoice '
    || duplicate.canonical_invoice_number,
  notes = concat_ws(
    E'\n',
    nullif(invoice.notes, ''),
    'Automatically voided after full duplicate audit. No payments, '
    || 'payment submissions, or audit entries were linked.'
  ),
  updated_at = now()
from duplicate_legacy_invoices as duplicate
where invoice.id = duplicate.id;

create unique index if not exists rent_bills_one_active_room_month_idx
  on public.rent_bills (room_id, bill_month)
  where removed_at is null
    and status not in ('cancelled', 'waived');
