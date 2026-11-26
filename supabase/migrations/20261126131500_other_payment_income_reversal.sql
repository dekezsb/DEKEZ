-- Other-payment income: a verified key, other or electricity top-up is linked
-- to that month's room invoice. Undo must still reverse the invoice line
-- (already deleted by payment_submission_id), recalculate paid_amount (needs
-- rent_bill_id on the submission at reverse time) and then clear the invoice
-- and tenancy links so the slip is pending again without suppressing rent
-- chasing.
--
-- Also replaces the pending-only no-rent-bill check with one that allows
-- rent_bill_id while the slip is verified, in case an earlier copy of
-- 20261126120000_other_payments.sql installed the stricter check.

alter table public.payment_submissions
  drop constraint if exists payment_submissions_other_payment_no_rent_bill;

alter table public.payment_submissions
  add constraint payment_submissions_other_payment_no_rent_bill
  check (
    bill_type <> 'other_payment'
    or rent_bill_id is null
    or verification_status = 'verified'
  );

create or replace function public.reverse_verified_payment_submission(
  p_submission_id uuid,
  p_actor_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_submission public.payment_submissions%rowtype;
  v_bill public.rent_bills%rowtype;
  v_payments jsonb;
  v_line_items jsonb;
  v_payment_count integer;
  v_extra_total numeric(12, 2) := 0;
  v_rent_total numeric(12, 2) := 0;
  v_deposit_required numeric(12, 2) := 0;
  v_rent_paid numeric(12, 2) := 0;
  v_deposit_paid numeric(12, 2) := 0;
  v_total_paid numeric(12, 2) := 0;
  v_total_due numeric(12, 2) := 0;
  v_new_status public.bill_status;
  v_reversed_at timestamptz := now();
begin
  if nullif(trim(p_reason), '') is null then
    raise exception 'A reversal reason is required';
  end if;

  select *
  into v_submission
  from public.payment_submissions
  where id = p_submission_id
  for update;

  if not found or v_submission.verification_status <> 'verified' then
    raise exception 'Only a verified payment can be reversed';
  end if;

  select count(*), coalesce(jsonb_agg(to_jsonb(payment_rows)), '[]'::jsonb)
  into v_payment_count, v_payments
  from (
    select *
    from public.payments
    where payment_submission_id = p_submission_id
      and status in ('confirmed', 'paid')
    for update
  ) payment_rows;

  if v_payment_count = 0 then
    raise exception 'No safely linked payment transaction was found';
  end if;

  select coalesce(jsonb_agg(to_jsonb(line_rows)), '[]'::jsonb)
  into v_line_items
  from (
    select *
    from public.rental_invoice_line_items
    where payment_submission_id = p_submission_id
  ) line_rows;

  update public.payments
  set status = 'cancelled',
      reversed_at = v_reversed_at,
      reversed_by = p_actor_id,
      reversal_reason = trim(p_reason),
      updated_at = v_reversed_at
  where payment_submission_id = p_submission_id
    and status in ('confirmed', 'paid');

  delete from public.rental_invoice_line_items
  where payment_submission_id = p_submission_id;

  if v_submission.rent_bill_id is not null then
    select *
    into v_bill
    from public.rent_bills
    where id = v_submission.rent_bill_id
    for update;

    select coalesce(sum(amount), 0)
    into v_extra_total
    from public.rental_invoice_line_items
    where rent_bill_id = v_bill.id;

    v_rent_total := greatest(coalesce(v_bill.amount, 0) + v_extra_total, 0);

    select greatest(
      coalesce(v_bill.deposit_amount, 0),
      coalesce(tenancies.deposit, 0)
    )
    into v_deposit_required
    from public.tenancies
    where tenancies.id = v_bill.tenancy_id;

    v_deposit_required := coalesce(v_deposit_required, coalesce(v_bill.deposit_amount, 0));

    select
      coalesce(sum(amount) filter (where category <> 'deposit'), 0),
      coalesce(sum(amount) filter (where category = 'deposit'), 0)
    into v_rent_paid, v_deposit_paid
    from public.payments
    where rent_bill_id = v_bill.id
      and status in ('confirmed', 'paid');

    v_rent_paid := least(v_rent_paid, v_rent_total);
    v_deposit_paid := least(v_deposit_paid, v_deposit_required);
    v_total_paid := v_rent_paid + v_deposit_paid;
    v_total_due := v_rent_total + v_deposit_required;
    v_new_status := case
      when v_total_paid >= v_total_due then 'paid'::public.bill_status
      when v_total_paid > 0 then 'partially_paid'::public.bill_status
      else 'unpaid'::public.bill_status
    end;

    update public.rent_bills
    set paid_amount = v_rent_paid,
        status = v_new_status,
        updated_at = v_reversed_at
    where id = v_bill.id;

    insert into public.rent_bill_audit_logs (
      bill_id,
      action,
      performed_by,
      old_status,
      new_status,
      old_paid_amount,
      new_paid_amount,
      reason
    )
    values (
      v_bill.id,
      'reverse_payment_submission',
      p_actor_id,
      v_bill.status::text,
      v_new_status::text,
      coalesce(v_bill.paid_amount, 0),
      v_rent_paid,
      trim(p_reason)
    );
  end if;

  -- Bill paid_amount has already been recalculated from v_submission.rent_bill_id.
  -- Clear the invoice and tenancy links on an other payment so the slip goes
  -- back to a pending state that cannot suppress rent chasing, and so the
  -- other-payment check constraint (rent_bill_id only while verified) holds.
  update public.payment_submissions
  set verification_status = 'pending_verification',
      verified_by = null,
      verified_at = null,
      rejection_reason = 'Verification undone: ' || trim(p_reason),
      updated_at = v_reversed_at,
      rent_bill_id = case
        when v_submission.bill_type = 'other_payment' then null
        else payment_submissions.rent_bill_id
      end,
      tenancy_id = case
        when v_submission.bill_type = 'other_payment' then null
        else payment_submissions.tenancy_id
      end,
      bill_month = case
        when v_submission.bill_type = 'other_payment' then null
        else payment_submissions.bill_month
      end
  where id = p_submission_id;

  insert into public.payment_verification_audit_logs (
    payment_submission_id,
    action,
    performed_by,
    old_status,
    new_status,
    reason,
    reversal_details
  )
  values (
    p_submission_id,
    'reversed',
    p_actor_id,
    'verified',
    'pending_verification',
    trim(p_reason),
    jsonb_build_object(
      'submission', to_jsonb(v_submission),
      'payments', v_payments,
      'invoice_line_items', v_line_items,
      'bill_before', case when v_bill.id is null then null else to_jsonb(v_bill) end
    )
  );

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'bill_id', v_submission.rent_bill_id,
    'bill_status', v_new_status,
    'reversed_at', v_reversed_at
  );
end;
$$;


revoke all on function public.reverse_verified_payment_submission(uuid, uuid, text)
  from public;
grant execute on function public.reverse_verified_payment_submission(uuid, uuid, text)
  to service_role;
