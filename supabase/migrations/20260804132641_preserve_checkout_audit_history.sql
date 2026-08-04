-- Checkout is a lifecycle change, not permission to erase accounting or legal
-- history. Keep July/current-month records for audit, cancel later billing,
-- and close unfinished agreement workflows without deleting their evidence.
create or replace function public.remove_checked_out_tenancy_documents()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  checkout_month date := date_trunc('month', new.checkout_date)::date;
begin
  update public.rent_bills
  set
    status = 'cancelled',
    notes = concat_ws(
      ' ',
      nullif(btrim(coalesce(notes, '')), ''),
      format(
        'Cancelled because the tenancy checked out on %s; %s is the final billing month.',
        to_char(new.checkout_date, 'DD/MM/YYYY'),
        to_char(checkout_month, 'FMMonth YYYY')
      )
    ),
    updated_at = now()
  where tenancy_id = new.id
    and bill_month > checkout_month
    and status in ('draft', 'unpaid', 'overdue', 'upcoming', 'due_today');

  update public.agreement_notifications
  set status = 'cancelled'
  where tenancy_id = new.id
    and status = 'pending';

  update public.tenancy_agreements
  set
    status = 'terminated',
    updated_at = now()
  where tenancy_id = new.id
    and signed_at is null
    and status in (
      'draft',
      'pending_signature',
      'renewal_pending',
      'renewal_sent'
    );

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
  'Preserves invoices and agreements at checkout, cancels only post-checkout billing and closes pending workflows.';
