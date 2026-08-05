-- Checkout closes the old tenant's operational balances but preserves rental
-- invoices as immutable seven-year accounting records. Only signed tenancy
-- agreements are legal records worth retaining after checkout.
create or replace function public.remove_checked_out_tenancy_documents()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  insert into public.rent_bill_audit_logs (
    bill_id,
    action,
    old_status,
    new_status,
    old_paid_amount,
    new_paid_amount,
    reason
  )
  select
    bill.id,
    'checkout_cancelled',
    bill.status::text,
    'cancelled',
    bill.paid_amount,
    bill.paid_amount,
    format(
      'Tenancy checked out on %s. Invoice retained for seven-year audit history and removed from current outstanding balances.',
      to_char(new.checkout_date, 'DD/MM/YYYY')
    )
  from public.rent_bills as bill
  where bill.tenancy_id = new.id
    and bill.status in (
      'draft',
      'unpaid',
      'partial',
      'submitted',
      'pending_verification',
      'rejected',
      'overdue',
      'upcoming',
      'due_today',
      'payment_submitted',
      'partially_paid'
    );

  update public.rent_bills
  set
    status = 'cancelled',
    retain_until = greatest(
      coalesce(retain_until, '-infinity'::date),
      (
        coalesce(invoice_date, due_date, bill_month) + interval '7 years'
      )::date
    ),
    notes = concat_ws(
      ' ',
      nullif(btrim(coalesce(notes, '')), ''),
      format(
        'Cancelled at checkout on %s; retained for seven-year invoice audit and excluded from current balances.',
        to_char(new.checkout_date, 'DD/MM/YYYY')
      )
    ),
    updated_at = now()
  where tenancy_id = new.id
    and status in (
      'draft',
      'unpaid',
      'partial',
      'submitted',
      'pending_verification',
      'rejected',
      'overdue',
      'upcoming',
      'due_today',
      'payment_submitted',
      'partially_paid'
    );

  update public.agreement_notifications
  set status = 'cancelled'
  where tenancy_id = new.id
    and status = 'pending';

  delete from public.document_archive_jobs
  where source_type = 'tenancy_agreement'
    and source_id in (
      select agreement.id
      from public.tenancy_agreements as agreement
      where agreement.tenancy_id = new.id
        and agreement.signed_at is null
        and agreement.status not in ('signed', 'renewal_signed')
    );

  update public.tenancy_agreement_verification_logs
  set replacement_agreement_id = null
  where replacement_agreement_id in (
    select agreement.id
    from public.tenancy_agreements as agreement
    where agreement.tenancy_id = new.id
      and agreement.signed_at is null
      and agreement.status not in ('signed', 'renewal_signed')
  );

  delete from public.tenancy_agreement_verification_logs
  where agreement_id in (
    select agreement.id
    from public.tenancy_agreements as agreement
    where agreement.tenancy_id = new.id
      and agreement.signed_at is null
      and agreement.status not in ('signed', 'renewal_signed')
  );

  update public.tenancy_agreements
  set replacement_agreement_id = null
  where replacement_agreement_id in (
    select agreement.id
    from public.tenancy_agreements as agreement
    where agreement.tenancy_id = new.id
      and agreement.signed_at is null
      and agreement.status not in ('signed', 'renewal_signed')
  );

  delete from public.tenancy_agreements
  where tenancy_id = new.id
    and signed_at is null
    and status not in ('signed', 'renewal_signed');

  update public.tenancy_renewals
  set
    renewal_status = 'not_renewing',
    decision_status = 'not_renew',
    decision_recorded_at = coalesce(decision_recorded_at, now()),
    decision_channel = coalesce(decision_channel, 'admin_recorded_checkout'),
    decision_note = concat_ws(
      ' ',
      nullif(btrim(coalesce(decision_note, '')), ''),
      format('Tenancy checked out on %s.', to_char(new.checkout_date, 'DD/MM/YYYY'))
    ),
    updated_at = now()
  where tenancy_id = new.id;

  return new;
end;
$$;

revoke all on function public.remove_checked_out_tenancy_documents()
from public, anon, authenticated;

comment on function public.remove_checked_out_tenancy_documents() is
  'At checkout, cancels every open invoice while retaining it for seven years, deletes unsigned agreements, preserves signed agreements, and closes renewal workflows.';

-- Repair every previously checked-out tenancy that still leaks an outstanding
-- balance into the live operational portals.
insert into public.rent_bill_audit_logs (
  bill_id,
  action,
  old_status,
  new_status,
  old_paid_amount,
  new_paid_amount,
  reason
)
select
  bill.id,
  'checkout_cancelled',
  bill.status::text,
  'cancelled',
  bill.paid_amount,
  bill.paid_amount,
  format(
    'Historical repair: tenancy checked out on %s. Invoice retained for seven-year audit history and removed from current outstanding balances.',
    to_char(tenancy.checkout_date, 'DD/MM/YYYY')
  )
from public.rent_bills as bill
join public.tenancies as tenancy on tenancy.id = bill.tenancy_id
where tenancy.status <> 'active'
  and tenancy.checkout_date is not null
  and bill.status in (
    'draft',
    'unpaid',
    'partial',
    'submitted',
    'pending_verification',
    'rejected',
    'overdue',
    'upcoming',
    'due_today',
    'payment_submitted',
    'partially_paid'
  );

update public.rent_bills as bill
set
  status = 'cancelled',
  retain_until = greatest(
    coalesce(bill.retain_until, '-infinity'::date),
    (
      coalesce(bill.invoice_date, bill.due_date, bill.bill_month) + interval '7 years'
    )::date
  ),
  notes = concat_ws(
    ' ',
    nullif(btrim(coalesce(bill.notes, '')), ''),
    format(
      'Cancelled at checkout on %s; retained for seven-year invoice audit and excluded from current balances.',
      to_char(tenancy.checkout_date, 'DD/MM/YYYY')
    )
  ),
  updated_at = now()
from public.tenancies as tenancy
where tenancy.id = bill.tenancy_id
  and tenancy.status <> 'active'
  and tenancy.checkout_date is not null
  and bill.status in (
    'draft',
    'unpaid',
    'partial',
    'submitted',
    'pending_verification',
    'rejected',
    'overdue',
    'upcoming',
    'due_today',
    'payment_submitted',
    'partially_paid'
  );

-- Apply the signed-only agreement archive rule to earlier checkouts as well.
delete from public.document_archive_jobs
where source_type = 'tenancy_agreement'
  and source_id in (
    select agreement.id
    from public.tenancy_agreements as agreement
    join public.tenancies as tenancy on tenancy.id = agreement.tenancy_id
    where tenancy.status <> 'active'
      and tenancy.checkout_date is not null
      and agreement.signed_at is null
      and agreement.status not in ('signed', 'renewal_signed')
  );

update public.tenancy_agreement_verification_logs
set replacement_agreement_id = null
where replacement_agreement_id in (
  select agreement.id
  from public.tenancy_agreements as agreement
  join public.tenancies as tenancy on tenancy.id = agreement.tenancy_id
  where tenancy.status <> 'active'
    and tenancy.checkout_date is not null
    and agreement.signed_at is null
    and agreement.status not in ('signed', 'renewal_signed')
);

delete from public.tenancy_agreement_verification_logs
where agreement_id in (
  select agreement.id
  from public.tenancy_agreements as agreement
  join public.tenancies as tenancy on tenancy.id = agreement.tenancy_id
  where tenancy.status <> 'active'
    and tenancy.checkout_date is not null
    and agreement.signed_at is null
    and agreement.status not in ('signed', 'renewal_signed')
);

update public.tenancy_agreements
set replacement_agreement_id = null
where replacement_agreement_id in (
  select agreement.id
  from public.tenancy_agreements as agreement
  join public.tenancies as tenancy on tenancy.id = agreement.tenancy_id
  where tenancy.status <> 'active'
    and tenancy.checkout_date is not null
    and agreement.signed_at is null
    and agreement.status not in ('signed', 'renewal_signed')
);

delete from public.tenancy_agreements as agreement
using public.tenancies as tenancy
where tenancy.id = agreement.tenancy_id
  and tenancy.status <> 'active'
  and tenancy.checkout_date is not null
  and agreement.signed_at is null
  and agreement.status not in ('signed', 'renewal_signed');
