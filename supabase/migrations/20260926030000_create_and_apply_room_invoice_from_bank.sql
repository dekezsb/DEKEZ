-- General QR reconciliation rule: when a bank transaction's own reference or
-- description clearly identifies a property+room, use property+room+date to
-- find the tenancy that occupied that room at that time (via
-- tenancy_for_room_at_date), then find or create the correct rental invoice
-- for that tenancy+month, then reconcile the bank money to it.
--
-- This function only ever finds-or-creates the ONE invoice for that exact
-- tenancy+bill_month (the existing unique(tenancy_id, bill_month) constraint
-- on rent_bills makes a duplicate impossible even under a race), then hands
-- the actual payment-creation/reconciliation entirely to the already-existing
-- apply_bank_to_room_invoice function - this function never inserts into
-- payments, bank_reconciliation_matches or any other financial table itself,
-- so every duplicate/room/month/balance/locked check apply_bank_to_room_invoice
-- already enforces still applies unchanged and is never weakened or bypassed.
--
-- If the room's current tenancy is checked out at the transaction date
-- (status <> 'active', or the room's current_tenancy_id no longer points at
-- it), the created invoice is tagged tenant_facing = false: it exists for
-- admin/accounting reconciliation only and must never surface as a new
-- outstanding bill to that former tenant. An invoice for the room's current,
-- still-active tenancy is created as an ordinary tenant_facing invoice and
-- follows the normal active-tenant invoice flow.
create or replace function public.create_and_apply_room_invoice_from_bank(
  p_company uuid, p_actor uuid, p_line uuid, p_kind text default 'monthly_rent'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  l public.bank_statement_lines%rowtype;
  s public.bank_statement_imports%rowtype;
  tenancy public.tenancies%rowtype;
  bill public.rent_bills%rowtype;
  v_property_id uuid;
  v_room_id uuid;
  v_room_status text;
  v_room_current_tenancy_id uuid;
  v_tenant_record_id uuid;
  v_tenant_profile_id uuid;
  locations text[];
  v_property_code text;
  v_room_code text;
  v_bill_month date;
  v_due_day integer;
  v_last_day integer;
  v_due_date date;
  v_amount numeric;
  v_tenant_facing boolean;
begin
  if p_company is null or p_actor is null or p_kind is null or p_kind not in ('monthly_rent', 'top_up_utilities')
    or not exists(select 1 from public.profiles where id = p_actor and role in ('super_admin', 'admin', 'owner'))
    then raise exception 'invoice_bank_not_authorized'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_company::text, 1801));

  select line.* into l from public.bank_statement_lines line
    join public.bank_statement_imports statement on statement.id = line.statement_import_id
    where line.id = p_line and statement.company_id = p_company for update of line;
  if l.id is null or l.amount <= 0 or l.status <> 'unmatched'
    or exists(select 1 from public.bank_reconciliation_matches where statement_line_id = p_line)
    then raise exception 'Possible duplicate transaction. Please review.'; end if;

  select * into s from public.bank_statement_imports where id = l.statement_import_id for share;
  if s.status <> 'in_progress' then raise exception 'invoice_bank_statement_locked'; end if;
  if exists(select 1 from public.accounting_periods where company_id = p_company and status = 'locked'
    and l.transaction_date between period_start and period_end)
    then raise exception 'invoice_bank_period_locked'; end if;

  -- Same whitelist-anchored property+room parser used everywhere else
  -- (lib/accounting/bank-room-scope.ts and apply_bank_to_room_invoice).
  -- Reject an ambiguous or missing room reference rather than guessing.
  select array_agg(distinct m[1] || ':' || regexp_replace(m[2], '^0+(?=[0-9])', '')) into locations
    from regexp_matches(upper(coalesce(l.reference_number, '') || ' ' || coalesce(l.description, '')),
      '\m(PTT|DGG|BDS|BVH|INS|HLT|KLB|SLY|MGT|SLS)\s*[-–—]?\s*(?:ROOM\s*)?([A-Z]?[0-9]+[A-Z]?)\M', 'g') m;
  if coalesce(cardinality(locations), 0) <> 1 then raise exception 'invoice_bank_wrong_room'; end if;
  v_property_code := split_part(locations[1], ':', 1);
  v_room_code := split_part(locations[1], ':', 2);

  select property.id into v_property_id from public.properties property
    where property.company_id = p_company and upper(property.property_code) = v_property_code;
  if v_property_id is null then raise exception 'invoice_bank_wrong_room'; end if;

  select room.id, room.status::text, room.current_tenancy_id into v_room_id, v_room_status, v_room_current_tenancy_id
    from public.rooms room
    where room.property_id = v_property_id
      and regexp_replace(regexp_replace(upper(room.room_number), '^ROOM\s*', ''), '^0+(?=[0-9])', '') = v_room_code;
  if v_room_id is null then raise exception 'invoice_bank_wrong_room'; end if;

  tenancy := public.tenancy_for_room_at_date(v_room_id, l.transaction_date);
  if tenancy.id is null then raise exception 'invoice_bank_tenancy_not_found'; end if;

  v_bill_month := date_trunc('month', l.transaction_date)::date;

  -- If a suitable invoice already exists for this exact tenancy+month, use it -
  -- never create a duplicate. The unique(tenancy_id, bill_month) constraint
  -- also enforces this at the database level regardless.
  select * into bill from public.rent_bills
    where tenancy_id = tenancy.id and bill_month = v_bill_month and removed_at is null
    for update;

  if bill.id is null then
    select tr.id into v_tenant_record_id from public.tenant_records tr
      where tr.tenancy_id = tenancy.id order by tr.created_at desc limit 1;

    -- rent_bills.tenant_id is a FK to auth.users(id) (the tenant's portal
    -- login), NOT to tenants(id) (tenancy.tenant_id is a tenants.id) - the
    -- same distinction the recurring billing engine already respects in
    -- lib/billing/rent-billing.ts via tenantProfileId()/tenants(profile_id).
    -- A tenant with no portal login yet has a null profile_id, which is a
    -- valid, already-supported value for this nullable column.
    select t.profile_id into v_tenant_profile_id from public.tenants t where t.id = tenancy.tenant_id;

    v_due_day := coalesce(tenancy.rent_due_day, tenancy.due_day, 1);
    v_last_day := extract(day from (v_bill_month + interval '1 month - 1 day'))::integer;
    v_due_date := v_bill_month + (least(greatest(v_due_day, 1), v_last_day) - 1);
    v_amount := coalesce(tenancy.monthly_rental, 0);
    -- Only the room's current, still-active tenancy behaves as a normal
    -- tenant-facing invoice. Anything else (checked out, or superseded by a
    -- later tenancy in this same room) is admin/accounting-only.
    v_tenant_facing := tenancy.status = 'active' and v_room_current_tenancy_id = tenancy.id;

    insert into public.rent_bills (
      organization_id, tenancy_id, tenant_id, property_id, unit_id, room_id,
      tenant_record_id, bill_month, due_date, amount, status,
      invoice_source, tenant_facing, created_by
    ) values (
      tenancy.organization_id, tenancy.id, v_tenant_profile_id, v_property_id, tenancy.unit_id, v_room_id,
      v_tenant_record_id, v_bill_month, v_due_date, v_amount, 'unpaid',
      'manual_historical', v_tenant_facing, p_actor
    ) returning * into bill;
  end if;

  -- Every duplicate/room/month/balance/locked/existing-slip check, and the
  -- actual payment creation and reconciliation, is done by the existing,
  -- already-tested apply_bank_to_room_invoice - this function never touches
  -- payments or bank_reconciliation_matches directly.
  return public.apply_bank_to_room_invoice(p_company, p_actor, p_line, bill.id, p_kind);
end;
$$;

revoke all on function public.create_and_apply_room_invoice_from_bank(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.create_and_apply_room_invoice_from_bank(uuid, uuid, uuid, text) to service_role;
