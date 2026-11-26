-- DEKEZ document numbering, step 2 of 2: every NEW document uses
-- <PREFIX><YY><MM>-<NNN> from public.next_document_number().
-- Run after 20261127090000_document_numbering_aliases.sql. Existing numbers stay.

-- Catch any old-style document created between step 1 and this step.
select public.backfill_document_number_aliases();

-- 1. Rental invoices: DINV-2026-1282 -> DINV2611-001 (month of bill_month).
create or replace function public.set_rental_invoice_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.invoice_number := old.invoice_number;
    new.invoice_date := old.invoice_date;
    new.issued_at := old.issued_at;
    new.retain_until := greatest(old.retain_until, new.retain_until);
    return new;
  end if;

  if new.invoice_number is null or btrim(new.invoice_number) = '' then
    new.invoice_number := public.next_document_number('DINV', new.bill_month::date);
  end if;

  new.invoice_date := coalesce(new.invoice_date, new.due_date, new.bill_month);
  new.issued_at := (
    new.invoice_date::timestamp at time zone 'Asia/Kuala_Lumpur'
  );
  new.retain_until := coalesce(
    new.retain_until,
    (new.invoice_date + interval '7 years')::date
  );
  return new;
end;
$$;

-- 2. Manual journals (and renovation journals, which post through the same
--    function): JE-20261019-B76EB5AC -> JE2611-001.
create or replace function public.post_manual_journal_entry(
  target_company_id uuid,
  target_entry_date date,
  target_reference_number text,
  target_description text,
  target_lines jsonb,
  target_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_id uuid := gen_random_uuid();
  entry_number_value text;
  debit_total numeric(14, 2);
  credit_total numeric(14, 2);
  line_count integer;
  invalid_line_count integer;
begin
  if target_company_id is null
    or target_entry_date is null
    or nullif(btrim(target_description), '') is null
    or target_created_by is null
    or jsonb_typeof(target_lines) <> 'array'
  then
    raise exception 'journal_details_required';
  end if;

  if not exists (
    select 1
    from public.profiles profiles
    where profiles.id = target_created_by
      and profiles.role::text in ('super_admin', 'admin')
  ) and not exists (
    select 1
    from public.company_users company_users
    where company_users.company_id = target_company_id
      and coalesce(company_users.user_id, company_users.profile_id) = target_created_by
      and company_users.status::text = 'active'
      and company_users.role::text in ('owner', 'admin', 'admin_team')
  ) then
    raise exception 'journal_not_allowed';
  end if;

  if exists (
    select 1
    from public.accounting_periods periods
    where periods.company_id = target_company_id
      and periods.status = 'locked'
      and target_entry_date between periods.period_start and periods.period_end
  ) then
    raise exception 'journal_period_locked';
  end if;

  select count(*)::integer,
    coalesce(sum(coalesce((line ->> 'debit')::numeric, 0)), 0),
    coalesce(sum(coalesce((line ->> 'credit')::numeric, 0)), 0)
  into line_count, debit_total, credit_total
  from jsonb_array_elements(target_lines) line;

  if line_count < 2 or line_count > 100 then
    raise exception 'journal_line_count';
  end if;

  select count(*)::integer
  into invalid_line_count
  from jsonb_array_elements(target_lines) line
  left join public.accounting_accounts accounts
    on accounts.id = nullif(line ->> 'account_id', '')::uuid
    and accounts.company_id = target_company_id
    and accounts.is_active
  left join public.properties properties
    on properties.id = nullif(line ->> 'property_id', '')::uuid
    and properties.company_id = target_company_id
  where accounts.id is null
    or (nullif(line ->> 'property_id', '') is not null and properties.id is null)
    or coalesce((line ->> 'debit')::numeric, 0) < 0
    or coalesce((line ->> 'credit')::numeric, 0) < 0
    or not (
      (coalesce((line ->> 'debit')::numeric, 0) > 0 and coalesce((line ->> 'credit')::numeric, 0) = 0)
      or (coalesce((line ->> 'credit')::numeric, 0) > 0 and coalesce((line ->> 'debit')::numeric, 0) = 0)
    );

  if invalid_line_count > 0 then
    raise exception 'journal_invalid_line';
  end if;
  if debit_total <= 0 or abs(debit_total - credit_total) > 0.005 then
    raise exception 'journal_not_balanced';
  end if;

  entry_number_value := public.next_document_number('JE', target_entry_date);
  insert into public.accounting_journal_entries (
    id, company_id, entry_date, entry_number, source_type, reference_number,
    description, status, posted_at, created_by
  ) values (
    entry_id, target_company_id, target_entry_date, entry_number_value,
    'manual_journal', nullif(btrim(target_reference_number), ''),
    btrim(target_description), 'posted', now(), target_created_by
  );

  insert into public.accounting_journal_lines (
    journal_entry_id, account_id, property_id, description, debit, credit
  )
  select
    entry_id,
    (line ->> 'account_id')::uuid,
    nullif(line ->> 'property_id', '')::uuid,
    nullif(btrim(line ->> 'description'), ''),
    round(coalesce((line ->> 'debit')::numeric, 0), 2),
    round(coalesce((line ->> 'credit')::numeric, 0), 2)
  from jsonb_array_elements(target_lines) line;

  insert into public.accounting_audit_logs (
    company_id, entity_type, entity_id, action, after_data, reason, performed_by
  ) values (
    target_company_id, 'accounting_journal_entry', entry_id, 'post_manual_journal',
    jsonb_build_object('entry_number', entry_number_value, 'debit', debit_total, 'credit', credit_total, 'lines', target_lines),
    'Balanced manual journal entry posted from DEKEZ Accounting.', target_created_by
  );

  return entry_id;
end;
$$;

revoke all on function public.post_manual_journal_entry(uuid, date, text, text, jsonb, uuid) from public;
revoke all on function public.post_manual_journal_entry(uuid, date, text, text, jsonb, uuid) from anon;
revoke all on function public.post_manual_journal_entry(uuid, date, text, text, jsonb, uuid) from authenticated;
grant execute on function public.post_manual_journal_entry(uuid, date, text, text, jsonb, uuid) to service_role;

comment on function public.post_manual_journal_entry(uuid, date, text, text, jsonb, uuid) is
  'Atomically posts one balanced manual journal with validated company accounts, optional property dimensions and a permanent audit record.';

-- 3. Bank-reconciliation payment vouchers: PV-20261030-<line uuid> -> PV2610-001.
--    They share the PV counter with the new Payment Voucher module, so a PV
--    number is unique across both screens.
-- Allow payment-voucher lines to use the full active chart of accounts while
-- preventing a circular posting back to the bank ledger being reconciled.
create or replace function public.record_bank_expense_voucher(
  p_company uuid, p_actor uuid, p_line uuid, p_payee text, p_lines jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  bank_line public.bank_statement_lines%rowtype;
  statement_row public.bank_statement_imports%rowtype;
  item jsonb;
  amount_value numeric;
  total_value numeric := 0;
  remaining_value numeric;
  account_value uuid;
  property_value uuid;
  transaction_value uuid;
  voucher_number text;
begin
  if p_actor is null or p_company is null or nullif(btrim(p_payee), '') is null or length(p_payee)>160
     or jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'voucher_details'; end if;
  if jsonb_array_length(p_lines) not between 1 and 50 then raise exception 'voucher_lines'; end if;
  select * into strict bank_line from public.bank_statement_lines where id=p_line for update;
  select * into strict statement_row from public.bank_statement_imports where id=bank_line.statement_import_id for share;
  if statement_row.company_id is distinct from p_company or statement_row.status <> 'in_progress'
    or bank_line.amount >= 0 or bank_line.status = 'ignored' then raise exception 'voucher_statement'; end if;
  if exists(select 1 from public.accounting_periods where company_id=p_company and status='locked'
    and bank_line.transaction_date between period_start and period_end) then raise exception 'voucher_period_locked'; end if;
  remaining_value := bank_line.amount - coalesce((select sum(matched_amount) from public.bank_reconciliation_matches where statement_line_id=p_line),0);
  if remaining_value >= 0 then raise exception 'voucher_already_matched'; end if;
  for item in select value from jsonb_array_elements(p_lines) loop
    if coalesce(item->>'amount','') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'voucher_amount'; end if;
    amount_value := (item->>'amount')::numeric;
    account_value := (item->>'accountId')::uuid;
    property_value := nullif(item->>'propertyId','office')::uuid;
    if amount_value <= 0 or amount_value > abs(remaining_value) or nullif(btrim(item->>'description'),'') is null
      or length(item->>'description')>300 or nullif(item->>'propertyId','') is null then raise exception 'voucher_details'; end if;
    if not exists(select 1 from public.accounting_accounts where id=account_value and company_id=p_company and is_active)
      or exists(select 1 from public.bank_accounts where id=bank_line.bank_account_id and accounting_account_id=account_value)
      then raise exception 'voucher_account'; end if;
    if property_value is not null and not exists(select 1 from public.properties where id=property_value and company_id=p_company)
      then raise exception 'voucher_property'; end if;
    if property_value is null and exists(select 1 from public.accounting_accounts where id=account_value and system_key='property_rental_cost')
      then raise exception 'voucher_property_required'; end if;
    total_value := total_value + amount_value;
  end loop;
  if total_value <> abs(remaining_value) then raise exception 'voucher_total'; end if;
  voucher_number := public.next_document_number('PV', bank_line.transaction_date);
  for item in select value from jsonb_array_elements(p_lines) loop
    insert into public.bank_manual_transactions(company_id,bank_account_id,offset_account_id,property_id,transaction_date,amount,description,reference_number,created_by)
      values(p_company,bank_line.bank_account_id,(item->>'accountId')::uuid,nullif(item->>'propertyId','office')::uuid,
        bank_line.transaction_date,-(item->>'amount')::numeric,btrim(p_payee)||' · '||btrim(item->>'description'),voucher_number,p_actor)
      returning id into transaction_value;
    insert into public.bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,match_method,created_by)
      values(p_line,'manual_bank_transaction',transaction_value,-(item->>'amount')::numeric,'adjustment',p_actor);
  end loop;
  update public.bank_statement_lines set status='adjusted',updated_at=now() where id=p_line;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,after_data,reason,performed_by)
    values(p_company,'bank_statement_line',p_line,'payment_voucher_created',
      jsonb_build_object('voucher_number',voucher_number,'payee',p_payee,'lines',p_lines,'total',total_value,
      'posting_date',bank_line.transaction_date,'statement_reference',bank_line.reference_number),
      'User reviewed and confirmed a multi-property payment voucher',p_actor);
  return jsonb_build_object('voucher_number',voucher_number,'statement_id',bank_line.statement_import_id);
end;
$$;

revoke all on function public.record_bank_expense_voucher(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_bank_expense_voucher(uuid,uuid,uuid,text,jsonb) to service_role;

-- 4. Renovation quotations / invoices (DQ-2026-000001 -> DQ2611-001,
--    DRI-2026-000004 -> DRI2611-001) and historical credit journals
--    (HRC-<uuid> -> HRC2611-001). These functions are long, so only the number
--    expression is swapped in the live definition; the migration stops if the
--    expected expression is missing rather than guessing.
do $numbering$
declare
  definition text;
begin
  definition := pg_get_functiondef('public.issue_renovation_document_base(uuid,uuid,uuid,integer,text,text,date,date)'::regprocedure);
  if position($q$'DQ-' || to_char(v_date,'YYYY') || '-' || lpad(nextval('public.renovation_quote_number_seq')::text,6,'0')$q$ in definition) = 0
    or position($q$'DRI-' || to_char(v_date,'YYYY') || '-' || lpad(nextval('public.renovation_invoice_number_seq')::text,6,'0')$q$ in definition) = 0 then
    raise exception 'renovation numbering expression not found; review issue_renovation_document_base manually';
  end if;
  definition := replace(definition,
    $q$'DQ-' || to_char(v_date,'YYYY') || '-' || lpad(nextval('public.renovation_quote_number_seq')::text,6,'0')$q$,
    $q$public.next_document_number('DQ', v_date)$q$);
  definition := replace(definition,
    $q$'DRI-' || to_char(v_date,'YYYY') || '-' || lpad(nextval('public.renovation_invoice_number_seq')::text,6,'0')$q$,
    $q$public.next_document_number('DRI', v_date)$q$);
  execute definition;

  definition := pg_get_functiondef('public.clear_historical_rental_credits(uuid,uuid,uuid,uuid,text)'::regprocedure);
  if position($q$'HRC-'||journal::text$q$ in definition) = 0 then
    raise exception 'historical credit numbering expression not found; review clear_historical_rental_credits manually';
  end if;
  execute replace(definition, $q$'HRC-'||journal::text$q$, $q$public.next_document_number('HRC', current_day)$q$);
end;
$numbering$;

-- 5. Maintenance tickets: DKZ-FD80939D -> DKZ2611-001 (Malaysia date of submission).
--    Tenants open tickets with their own session, so they get a narrow helper
--    that can only issue DKZ numbers, never other document families.
create or replace function public.next_maintenance_ticket_number()
returns text
language sql
security definer
set search_path = ''
as $$
  select public.next_document_number('DKZ', (now() at time zone 'Asia/Kuala_Lumpur')::date);
$$;
revoke all on function public.next_maintenance_ticket_number() from public, anon;
grant execute on function public.next_maintenance_ticket_number() to authenticated, service_role;

alter table public.maintenance_tickets
  alter column ticket_number set default public.next_maintenance_ticket_number();

revoke execute on function public.set_rental_invoice_metadata() from public, anon, authenticated;
