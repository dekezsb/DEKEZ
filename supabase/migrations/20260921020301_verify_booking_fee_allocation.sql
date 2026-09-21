create or replace function public.verify_booking_fee_allocation(
  p_submission uuid,
  p_actor uuid,
  p_allocation text,
  p_amount numeric,
  p_payment_date date
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.payment_submissions%rowtype;
  b public.rent_bills%rowtype;
  t public.tenancies%rowtype;
  rent_required numeric := 0;
  deposit_required numeric := 0;
  deposit_paid numeric := 0;
  new_rent_paid numeric := 0;
  new_status public.bill_status;
begin
  if not exists (
    select 1
    from public.profiles
    where id = p_actor
      and (role = 'super_admin' or global_role = 'super_admin')
  ) then
    raise exception 'Only Super Admin can allocate a booking fee';
  end if;

  if p_allocation not in ('monthly_rent', 'deposit')
    or p_amount is null
    or p_amount <= 0
    or p_amount <> round(p_amount, 2)
    or p_payment_date is null
  then
    raise exception 'Invalid booking fee allocation';
  end if;

  select * into strict s
  from public.payment_submissions
  where id = p_submission
  for update;

  if s.verification_status = 'verified' then
    return jsonb_build_object(
      'submission_id', s.id,
      'rent_bill_id', s.rent_bill_id,
      'tenancy_id', s.tenancy_id,
      'already_verified', true
    );
  end if;

  if s.verification_status <> 'pending_verification'
    or s.payment_type <> 'booking_fee'
    or s.tenancy_id is null
    or s.rent_bill_id is null
  then
    raise exception 'Booking fee is not ready for allocation';
  end if;

  select * into strict t
  from public.tenancies
  where id = s.tenancy_id
    and status = 'active'
    and checkout_date is null
  for update;

  select * into strict b
  from public.rent_bills
  where id = s.rent_bill_id
    and tenancy_id = t.id
    and status not in ('cancelled', 'waived')
  for update;

  if exists (
    select 1
    from public.payments
    where payment_submission_id = s.id
      and reversed_at is null
      and status in ('confirmed', 'paid')
  ) then
    raise exception 'Booking fee already has a payment record';
  end if;

  select coalesce(b.amount, 0) + coalesce(sum(items.amount), 0)
  into rent_required
  from public.rental_invoice_line_items items
  where items.rent_bill_id = b.id;

  deposit_required := greatest(coalesce(t.deposit, 0), coalesce(b.deposit_amount, 0));
  select coalesce(sum(payments.amount), 0)
  into deposit_paid
  from public.payments payments
  where payments.tenancy_id = t.id
    and payments.category in ('deposit', 'rental_deposit', 'security_deposit', 'utility_deposit')
    and payments.status in ('confirmed', 'paid')
    and payments.reversed_at is null;

  if p_allocation = 'monthly_rent'
    and p_amount > greatest(rent_required - coalesce(b.paid_amount, 0), 0)
  then
    raise exception 'Booking fee exceeds rent outstanding';
  end if;

  if p_allocation = 'deposit'
    and p_amount > greatest(deposit_required - deposit_paid, 0)
  then
    raise exception 'Booking fee exceeds deposit outstanding';
  end if;

  insert into public.payments(
    company_id, organization_id, payment_submission_id, rent_bill_id,
    tenant_id, tenancy_id, property_id, unit_id, room_id, category,
    amount, payment_date, payment_method, reference_number, status,
    recorded_by, verified_by, verified_at, notes
  ) values (
    t.company_id, t.organization_id, s.id, b.id,
    s.tenant_id, t.id, s.property_id, s.unit_id, s.room_id, p_allocation,
    p_amount, p_payment_date, s.payment_method, s.reference_number, 'confirmed',
    p_actor, p_actor, now(),
    case
      when p_allocation = 'monthly_rent' then 'Booking fee allocated to monthly rent'
      else 'Booking fee allocated to deposit'
    end
  );

  new_rent_paid := coalesce(b.paid_amount, 0)
    + case when p_allocation = 'monthly_rent' then p_amount else 0 end;
  if p_allocation = 'deposit' then
    deposit_paid := deposit_paid + p_amount;
  end if;
  new_status := case
    when new_rent_paid >= rent_required and deposit_paid >= deposit_required
      then 'paid'::public.bill_status
    else 'partially_paid'::public.bill_status
  end;

  update public.rent_bills
  set paid_amount = new_rent_paid,
      status = new_status,
      updated_at = now()
  where id = b.id;

  update public.payment_submissions
  set amount = p_amount,
      payment_date = p_payment_date,
      verification_status = 'verified',
      verified_by = p_actor,
      verified_at = now(),
      rejection_reason = null,
      updated_at = now()
  where id = s.id;

  insert into public.rent_bill_audit_logs(
    bill_id, action, performed_by, old_status, new_status,
    old_paid_amount, new_paid_amount, reason
  ) values (
    b.id, 'verify_payment_submission', p_actor, b.status, new_status,
    b.paid_amount, new_rent_paid,
    'Booking fee allocated to ' || p_allocation || ': ' || s.id::text
  );

  insert into public.payment_verification_audit_logs(
    payment_submission_id, action, performed_by, old_status, new_status, reason
  ) values (
    s.id, 'verified', p_actor, s.verification_status, 'verified',
    'Booking fee retained as booking fee and allocated to ' || p_allocation
  );

  if s.tenant_application_id is not null then
    update public.tenant_applications applications
    set payment_status = case
          when exists (
            select 1
            from public.payment_submissions pending
            where pending.tenant_application_id = applications.id
              and pending.id <> s.id
              and pending.verification_status = 'pending_verification'
          ) then 'pending_verification'
          else 'verified'
        end,
        updated_at = now()
    where applications.id = s.tenant_application_id;
  end if;

  return jsonb_build_object(
    'submission_id', s.id,
    'rent_bill_id', b.id,
    'tenancy_id', t.id,
    'allocation', p_allocation,
    'amount', p_amount,
    'bill_status', new_status,
    'rent_paid', new_rent_paid
  );
end;
$$;

revoke all on function public.verify_booking_fee_allocation(uuid, uuid, text, numeric, date)
from public, anon, authenticated;
grant execute on function public.verify_booking_fee_allocation(uuid, uuid, text, numeric, date)
to service_role;

comment on function public.verify_booking_fee_allocation(uuid, uuid, text, numeric, date) is
  'Atomically retains a booking-fee submission while allocating its verified amount to rent or deposit after check-in.';
