-- Roll electricity top-ups out to every active tenancy and post each completed
-- top-up exactly once to the tenant's monthly invoice and income ledger.

alter table public.smart_meter_top_up_requests
  add column if not exists bill_month date,
  add column if not exists payment_date date,
  add column if not exists rent_bill_id uuid
    references public.rent_bills(id) on delete restrict;

update public.smart_meter_top_up_requests
set
  bill_month = coalesce(
    bill_month,
    date_trunc(
      'month',
      timezone('Asia/Kuala_Lumpur', coalesce(created_at, now()))
    )::date
  ),
  payment_date = coalesce(
    payment_date,
    timezone('Asia/Kuala_Lumpur', coalesce(created_at, now()))::date
  )
where bill_month is null
   or payment_date is null;

alter table public.smart_meter_top_up_requests
  alter column bill_month set default (
    date_trunc('month', timezone('Asia/Kuala_Lumpur', now()))::date
  ),
  alter column bill_month set not null,
  alter column payment_date set default (
    timezone('Asia/Kuala_Lumpur', now())::date
  ),
  alter column payment_date set not null;

create index if not exists smart_meter_top_up_bill_idx
  on public.smart_meter_top_up_requests (rent_bill_id)
  where rent_bill_id is not null;

create index if not exists smart_meter_top_up_billing_month_idx
  on public.smart_meter_top_up_requests (bill_month, status, created_at desc);

alter table public.rental_invoice_line_items
  add column if not exists smart_meter_top_up_request_id uuid
    references public.smart_meter_top_up_requests(id) on delete restrict;

create unique index if not exists rental_invoice_line_items_top_up_unique
  on public.rental_invoice_line_items (smart_meter_top_up_request_id)
  where smart_meter_top_up_request_id is not null;

alter table public.rental_invoice_line_items
  drop constraint if exists rental_invoice_line_items_category_check;

alter table public.rental_invoice_line_items
  add constraint rental_invoice_line_items_category_check
  check (
    category = any (
      array[
        'key_lock'::text,
        'electricity'::text,
        'water'::text,
        'access_card'::text,
        'damage'::text,
        'cleaning'::text,
        'furniture'::text,
        'top_up_utilities'::text,
        'other'::text
      ]
    )
  );

alter table public.payments
  add column if not exists smart_meter_top_up_request_id uuid
    references public.smart_meter_top_up_requests(id) on delete restrict;

create unique index if not exists payments_top_up_request_unique
  on public.payments (smart_meter_top_up_request_id)
  where smart_meter_top_up_request_id is not null;

drop policy if exists "smart_meter_top_up_insert_own_bds"
  on public.smart_meter_top_up_requests;
drop policy if exists "smart_meter_top_up_insert_own_active_tenancy"
  on public.smart_meter_top_up_requests;

create policy "smart_meter_top_up_insert_own_active_tenancy"
on public.smart_meter_top_up_requests
for insert
to authenticated
with check (
  tenant_profile_id = (select auth.uid())
  and status = 'pending_verification'
  and rent_bill_id is null
  and exists (
    select 1
    from public.tenancies as tenancy
    join public.tenants as tenant on tenant.id = tenancy.tenant_id
    where tenancy.id = smart_meter_top_up_requests.tenancy_id
      and tenancy.room_id = smart_meter_top_up_requests.room_id
      and tenancy.property_id = smart_meter_top_up_requests.property_id
      and tenant.id = smart_meter_top_up_requests.tenant_record_id
      and tenant.profile_id = (select auth.uid())
      and tenancy.status = 'active'
      and coalesce(tenancy.billing_status, 'active')
        not in ('completed', 'terminated')
  )
);

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

  if target_meter.id is null then
    raise exception 'active_electricity_meter_required';
  end if;

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

  previous_credit := target_meter.remaining_credit;
  next_credit := previous_credit + target_request.amount;

  update public.smart_meters
  set
    tenant_id = target_request.tenant_record_id,
    tenancy_id = target_request.tenancy_id,
    remaining_credit = next_credit,
    updated_at = now()
  where id = target_meter.id;

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

create or replace function public.protect_credited_smart_meter_top_up()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'credited' and old.retain_until >= current_date then
      raise exception
        'Credited electricity top-up records must be retained until %.',
        old.retain_until;
    end if;
    return old;
  end if;

  if old.status = 'credited' and (
    new.id is distinct from old.id
    or new.amount is distinct from old.amount
    or new.payment_slip_bucket is distinct from old.payment_slip_bucket
    or new.payment_slip_path is distinct from old.payment_slip_path
    or new.payment_slip_name is distinct from old.payment_slip_name
    or new.bill_month is distinct from old.bill_month
    or new.payment_date is distinct from old.payment_date
    or new.rent_bill_id is distinct from old.rent_bill_id
    or new.status is distinct from old.status
    or new.provider_reference is distinct from old.provider_reference
    or new.credit_before is distinct from old.credit_before
    or new.credit_after is distinct from old.credit_after
    or new.retain_until < old.retain_until
  ) then
    raise exception 'Credited electricity top-up audit records are immutable.';
  end if;

  return new;
end;
$$;

drop trigger if exists smart_meter_top_up_protect_credited
  on public.smart_meter_top_up_requests;
create trigger smart_meter_top_up_protect_credited
before delete or update
on public.smart_meter_top_up_requests
for each row
execute function public.protect_credited_smart_meter_top_up();

revoke execute on function public.protect_credited_smart_meter_top_up()
  from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'smart_meter_top_up_requests'
  ) then
    alter publication supabase_realtime
      add table public.smart_meter_top_up_requests;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'rental_invoice_line_items'
  ) then
    alter publication supabase_realtime
      add table public.rental_invoice_line_items;
  end if;
end
$$;
