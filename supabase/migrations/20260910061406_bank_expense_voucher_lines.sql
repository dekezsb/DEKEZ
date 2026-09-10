-- Server-only, atomic expense voucher; no public client write privileges.
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
    if not exists(select 1 from public.accounting_accounts where id=account_value and company_id=p_company
      and account_type='expense' and is_active) then raise exception 'voucher_account'; end if;
    if property_value is not null and not exists(select 1 from public.properties where id=property_value and company_id=p_company)
      then raise exception 'voucher_property'; end if;
    if property_value is null and exists(select 1 from public.accounting_accounts where id=account_value and system_key='property_rental_cost')
      then raise exception 'voucher_property_required'; end if;
    total_value := total_value + amount_value;
  end loop;
  if total_value <> abs(remaining_value) then raise exception 'voucher_total'; end if;
  voucher_number := 'PV-' || to_char(bank_line.transaction_date,'YYYYMMDD') || '-' || upper(replace(p_line::text,'-',''));
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
    values(p_company,'bank_statement_line',p_line,'expense_voucher_created',
      jsonb_build_object('voucher_number',voucher_number,'payee',p_payee,'lines',p_lines,'total',total_value,
      'posting_date',bank_line.transaction_date,'statement_reference',bank_line.reference_number),
      'User reviewed and confirmed new multi-property expense voucher',p_actor);
  return jsonb_build_object('voucher_number',voucher_number,'statement_id',bank_line.statement_import_id);
end;
$$;
revoke all on function public.record_bank_expense_voucher(uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_bank_expense_voucher(uuid,uuid,uuid,text,jsonb) to service_role;
