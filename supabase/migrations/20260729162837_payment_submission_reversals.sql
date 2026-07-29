alter table public.payments
  add column if not exists payment_submission_id uuid
    references public.payment_submissions(id) on delete set null,
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid
    references auth.users(id) on delete set null,
  add column if not exists reversal_reason text;

create index if not exists payments_submission_idx
  on public.payments (payment_submission_id);

alter table public.payment_verification_audit_logs
  add column if not exists reversal_details jsonb;

-- Link legacy payment rows only when the verification timestamp identifies one
-- unambiguous source submission. This keeps future reversals deterministic.
with candidates as (
  select
    payments.id as payment_id,
    submissions.id as submission_id,
    count(*) over (partition by payments.id) as candidate_count
  from public.payments
  join public.payment_submissions submissions
    on submissions.rent_bill_id = payments.rent_bill_id
   and submissions.tenancy_id = payments.tenancy_id
   and submissions.payment_date = payments.payment_date
   and submissions.verification_status = 'verified'
   and submissions.verified_at is not null
   and payments.verified_at is not null
   and abs(
     extract(epoch from (payments.verified_at - submissions.verified_at))
   ) <= 600
  where payments.payment_submission_id is null
    and payments.status in ('confirmed', 'paid')
)
update public.payments payments
set payment_submission_id = candidates.submission_id,
    updated_at = now()
from candidates
where payments.id = candidates.payment_id
  and candidates.candidate_count = 1;

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

  update public.payment_submissions
  set verification_status = 'pending_verification',
      verified_by = null,
      verified_at = null,
      rejection_reason = 'Verification undone: ' || trim(p_reason),
      updated_at = v_reversed_at
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
