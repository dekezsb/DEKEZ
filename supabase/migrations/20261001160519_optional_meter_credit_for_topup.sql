-- Some properties (e.g. BVH) don't have a live CNYIOT smart meter installed
-- or connected yet, and may never get the vendor's API access to do so.
-- Tenants there still need to be able to pay for electricity top-ups and
-- have staff record that payment cleanly (so it doesn't get confused with
-- rent during bank reconciliation) even though there is no live meter
-- balance to credit.
--
-- This makes the "confirm meter credited" step tolerate a room with no
-- active electricity smart meter: instead of refusing the whole request
-- with active_electricity_meter_required, it records the verified payment
-- and invoice line item exactly as before, just without touching
-- smart_meters or setting credit_before/credit_after (left null to signal
-- "no live meter was credited"). Behaviour for a room that DOES have an
-- active meter (every HLT room today) is unchanged byte-for-byte.
create or replace function public.confirm_smart_meter_top_up_credit(
  request_id uuid,
  reviewer_id uuid,
  external_reference text
)
returns public.smart_meter_top_up_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.smart_meter_top_up_requests;
  target_meter public.smart_meters;
  target_tenancy public.tenancies;
  target_tenant public.tenants;
  target_bill public.rent_bills;
  updated_request public.smart_meter_top_up_requests;
  previous_credit numeric(12, 2);
  next_credit numeric(12, 2);
  invoice_extra_total numeric(12, 2);
  due_day integer;
  invoice_due_date date;
  has_meter boolean;
begin
  if nullif(btrim(external_reference), '') is null then
    raise exception 'provider_reference_required';
  end if;

  select request.*
  into target_request
  from public.smart_meter_top_up_requests as request
  where request.id = request_id
  for update;

  if target_request.id is null
    or target_request.status <> 'approved_awaiting_top_up' then
    raise exception 'top_up_request_not_ready';
  end if;

  select tenancy.*
  into target_tenancy
  from public.tenancies as tenancy
  where tenancy.id = target_request.tenancy_id
    and tenancy.room_id = target_request.room_id
    and tenancy.property_id = target_request.property_id
  for update;

  if target_tenancy.id is null then
    raise exception 'top_up_tenancy_not_found';
  end if;

  select tenant.*
  into target_tenant
  from public.tenants as tenant
  where tenant.id = target_request.tenant_record_id
    and tenant.profile_id = target_request.tenant_profile_id;

  if target_tenant.id is null then
    raise exception 'top_up_tenant_not_found';
  end if;

  select meter.*
  into target_meter
  from public.smart_meters as meter
  where (
      meter.id = target_request.meter_id
      or (
        target_request.meter_id is null
        and meter.room_id = target_request.room_id
      )
    )
    and meter.meter_type = 'electricity'
    and meter.status = 'active'
  order by (meter.id = target_request.meter_id) desc, meter.updated_at desc
  limit 1
  for update;

  -- No raise here anymore: a room with no active electricity meter simply
  -- records the payment below without a meter credit.
  has_meter := target_meter.id is not null;

  select bill.*
  into target_bill
  from public.rent_bills as bill
  where bill.tenancy_id = target_request.tenancy_id
    and bill.bill_month = target_request.bill_month
    and bill.removed_at is null
    and bill.status not in ('cancelled', 'waived')
  limit 1
  for update;

  if target_bill.id is null then
    due_day := least(
      greatest(
        coalesce(
          target_tenancy.rent_due_day,
          target_tenancy.due_day,
          extract(
            day from coalesce(
              target_tenancy.check_in_date,
              target_tenancy.tenancy_start_date,
              target_tenancy.contract_start,
              target_request.bill_month
            )
          )::integer,
          1
        ),
        1
      ),
      extract(
        day from (
          target_request.bill_month + interval '1 month - 1 day'
        )
      )::integer
    );
    invoice_due_date := (
      target_request.bill_month + (due_day - 1) * interval '1 day'
    )::date;

    insert into public.rent_bills (
      organization_id,
      tenancy_id,
      tenant_id,
      property_id,
      unit_id,
      room_id,
      bill_month,
      due_date,
      invoice_date,
      amount,
      paid_amount,
      status,
      created_by
    )
    values (
      target_tenancy.organization_id,
      target_tenancy.id,
      target_request.tenant_profile_id,
      target_tenancy.property_id,
      target_tenancy.unit_id,
      target_tenancy.room_id,
      target_request.bill_month,
      invoice_due_date,
      invoice_due_date,
      coalesce(target_tenancy.monthly_rental, target_tenancy.monthly_rent, 0),
      0,
      'unpaid',
      reviewer_id
    )
    on conflict (tenancy_id, bill_month) do nothing;

    select bill.*
    into target_bill
    from public.rent_bills as bill
    where bill.tenancy_id = target_request.tenancy_id
      and bill.bill_month = target_request.bill_month
      and bill.removed_at is null
      and bill.status not in ('cancelled', 'waived')
    limit 1
    for update;
  end if;

  if target_bill.id is null then
    raise exception 'monthly_invoice_required';
  end if;

  if has_meter then
    previous_credit := target_meter.remaining_credit;
    next_credit := previous_credit + target_request.amount;

    update public.smart_meters
    set
      tenant_id = target_request.tenant_record_id,
      tenancy_id = target_request.tenancy_id,
      remaining_credit = next_credit,
      updated_at = now()
    where id = target_meter.id;
  else
    previous_credit := null;
    next_credit := null;
  end if;

  if exists(select 1 from public.payments where smart_meter_top_up_request_id=target_request.id and origin_bank_line_id is not null) then
    if not exists(select 1 from public.payments p join public.rental_invoice_line_items i
      on i.origin_bank_line_id=p.origin_bank_line_id and i.smart_meter_top_up_request_id=p.smart_meter_top_up_request_id
      where p.smart_meter_top_up_request_id=target_request.id and p.status='confirmed' and p.reversed_at is null
        and p.rent_bill_id=target_bill.id and i.rent_bill_id=target_bill.id
        and p.amount=target_request.amount and i.amount=target_request.amount)
      then raise exception 'Bank invoice settlement needs review'; end if;
  else
  insert into public.rental_invoice_line_items (
    rent_bill_id,
    smart_meter_top_up_request_id,
    category,
    description,
    amount,
    created_by,
    updated_at
  )
  values (
    target_bill.id,
    target_request.id,
    'top_up_utilities',
    'Top Up Utilities - Electricity',
    target_request.amount,
    reviewer_id,
    now()
  )
  on conflict (smart_meter_top_up_request_id)
    where smart_meter_top_up_request_id is not null
  do nothing;

  select coalesce(sum(item.amount), 0)
  into invoice_extra_total
  from public.rental_invoice_line_items as item
  where item.rent_bill_id = target_bill.id;

  update public.rent_bills
  set
    paid_amount = paid_amount + target_request.amount,
    status = case
      when status = 'paid' then 'paid'::public.bill_status
      when paid_amount + target_request.amount >=
        amount + deposit_amount + invoice_extra_total
        then 'paid'::public.bill_status
      else 'partially_paid'::public.bill_status
    end,
    updated_at = now()
  where id = target_bill.id;

  insert into public.payments (
    company_id,
    organization_id,
    tenant_id,
    tenancy_id,
    property_id,
    unit_id,
    room_id,
    rent_bill_id,
    smart_meter_top_up_request_id,
    category,
    amount,
    payment_date,
    payment_method,
    reference_number,
    notes,
    status,
    recorded_by,
    verified_by,
    verified_at
  )
  values (
    target_tenancy.company_id,
    target_tenancy.organization_id,
    target_request.tenant_profile_id,
    target_tenancy.id,
    target_tenancy.property_id,
    target_tenancy.unit_id,
    target_tenancy.room_id,
    target_bill.id,
    target_request.id,
    'top_up_utilities',
    target_request.amount,
    target_request.payment_date,
    'bank_transfer',
    btrim(external_reference),
    'Verified electricity top-up income',
    'confirmed',
    reviewer_id,
    reviewer_id,
    now()
  )
  on conflict (smart_meter_top_up_request_id)
    where smart_meter_top_up_request_id is not null
  do nothing;

  end if; -- bank-origin invoice already settled

  update public.smart_meter_top_up_requests
  set
    meter_id = target_meter.id,
    rent_bill_id = target_bill.id,
    status = 'credited',
    provider_reference = btrim(external_reference),
    credited_by = reviewer_id,
    credited_at = now(),
    credit_before = previous_credit,
    credit_after = next_credit,
    updated_at = now()
  where id = target_request.id
  returning * into updated_request;

  return updated_request;
end;
$$;

revoke all on function public.confirm_smart_meter_top_up_credit(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirm_smart_meter_top_up_credit(uuid, uuid, text)
  to service_role;
