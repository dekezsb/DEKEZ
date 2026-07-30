do $$
begin
  if exists (
    select 1
    from public.rent_bills as bill
    where bill.removal_reason like
      'Duplicate legacy invoice; replaced by active-tenancy invoice %'
      and (
        exists (
          select 1
          from public.payment_submissions
          where rent_bill_id = bill.id
        )
        or exists (
          select 1
          from public.payments
          where rent_bill_id = bill.id
        )
        or exists (
          select 1
          from public.rent_bill_audit_logs
          where bill_id = bill.id
        )
        or exists (
          select 1
          from public.rent_reminder_logs
          where bill_id = bill.id
        )
        or exists (
          select 1
          from public.rental_invoice_line_items
          where rent_bill_id = bill.id
        )
      )
  ) then
    raise exception
      'Duplicate invoice purge stopped: a candidate has linked accounting records';
  end if;
end
$$;

create or replace function public.prevent_rental_invoice_early_delete()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if
    old.status = 'draft'
    and coalesce(old.paid_amount, 0) = 0
    and current_setting('dekez.allow_draft_invoice_delete', true) = 'on'
  then
    return old;
  end if;

  if
    current_setting('dekez.allow_checkout_invoice_delete', true) = 'on'
    and exists (
      select 1
      from public.tenancies
      where id = old.tenancy_id
        and checkout_date is not null
        and status <> 'active'
    )
  then
    return old;
  end if;

  if
    current_setting('dekez.allow_duplicate_invoice_delete', true) = 'on'
    and old.removal_reason like
      'Duplicate legacy invoice; replaced by active-tenancy invoice %'
  then
    return old;
  end if;

  raise exception
    'Rental invoice % cannot be permanently deleted. Void it instead.',
    old.invoice_number;
end;
$function$;

set local dekez.allow_duplicate_invoice_delete = 'on';

delete from public.rent_bills
where removal_reason like
  'Duplicate legacy invoice; replaced by active-tenancy invoice %';
