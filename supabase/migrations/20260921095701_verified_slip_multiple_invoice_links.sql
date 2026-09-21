-- Same verified parent slip may cover different existing invoices.
-- No new tables/columns or financial master writes; retain bounded allocation and locks.
create or replace function public.reconcile_existing_payment_allocation(p_company uuid,p_line uuid,p_payment uuid,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l public.bank_statement_lines%rowtype; chosen public.payments%rowtype; part public.payments%rowtype;
  ids uuid[]; remaining numeric; bank_remaining numeric; to_apply numeric; applied numeric; links jsonb:='[]'::jsonb; match_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
  if not exists(select 1 from public.profiles where id=p_actor and role in ('super_admin','admin','owner')) then raise exception 'Not authorized'; end if;
  select b.* into l from public.bank_statement_lines b join public.bank_statement_imports s on s.id=b.statement_import_id
    where b.id=p_line and s.company_id=p_company and s.status='in_progress' for update of b;
  if l.id is null or l.amount<=0 or l.status<>'unmatched' or exists(select 1 from public.bank_reconciliation_matches where statement_line_id=p_line and not existing_payment_link) then
    raise exception 'Possible duplicate transaction. Please review.';
  end if;
  select * into chosen from public.payments where id=p_payment and company_id=p_company for update;
  if chosen.id is null or chosen.status<>'confirmed' or chosen.reversed_at is not null then raise exception 'Existing confirmed payment required'; end if;
  if chosen.payment_submission_id is not null then
    perform 1 from public.payment_submissions where id=chosen.payment_submission_id and verification_status='verified' for update;
    if not found then raise exception 'Existing verified slip required'; end if;
    select array_agg(id order by id) into ids from public.payments where payment_submission_id=chosen.payment_submission_id and reversed_at is null;
  else ids:=array[p_payment]; end if;
  perform 1 from public.payments where id=any(ids) order by id for update;
  if exists(select 1 from public.payments p where id=any(ids) and (p.company_id is distinct from p_company or p.status<>'confirmed' or p.amount<=0
    or p.tenancy_id is distinct from chosen.tenancy_id or p.property_id is distinct from chosen.property_id or p.room_id is distinct from chosen.room_id
    or p.payment_date is distinct from chosen.payment_date)) then raise exception 'Inconsistent verified slip allocation'; end if;
  if exists(select 1 from public.bank_reconciliation_matches m where (m.source_type='payment' and m.source_id=any(ids) and not m.existing_payment_link)
    or (m.source_type='rent_bill' and m.source_id in (select rent_bill_id from public.payments where id=any(ids)))) then raise exception 'Possible duplicate transaction. Please review.'; end if;
  -- Preserve the existing bank-month scope for EVERY child, not just the representative.
  if exists(select 1 from public.payments p join public.rent_bills b on b.id=p.rent_bill_id
    where p.id=any(ids) and date_trunc('month',b.bill_month)::date is distinct from date_trunc('month',l.transaction_date)::date) then
    raise exception 'Invoice must be from the same bank month';
  end if;
  select sum(p.amount-coalesce((select sum(m.matched_amount) from public.bank_reconciliation_matches m where m.source_type='payment' and m.source_id=p.id),0))
    into remaining from public.payments p where id=any(ids);
  select l.amount-coalesce(sum(matched_amount),0) into bank_remaining from public.bank_reconciliation_matches where statement_line_id=p_line;
  if remaining<=0 or remaining is null or bank_remaining<=0 then raise exception 'No remaining verified payment or bank balance'; end if;
  to_apply:=least(remaining,bank_remaining);
  for part in select * from public.payments where id=any(ids) order by id loop
    select part.amount-coalesce(sum(matched_amount),0) into remaining from public.bank_reconciliation_matches where source_type='payment' and source_id=part.id;
    applied:=least(remaining,to_apply);
    if applied>0 then
      insert into public.bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,match_method,created_by,existing_payment_link)
        values(p_line,'payment',part.id,applied,case when cardinality(ids)>1 then 'merge' else 'split' end,p_actor,true) returning id into match_id;
      links:=links||jsonb_build_array(jsonb_build_object('match_id',match_id,'payment_id',part.id,'amount',applied));
      to_apply:=to_apply-applied;
      perform public.sync_existing_payment_link_state(part.id,p_actor);
    end if;
  end loop;
  if to_apply<>0 then raise exception 'Selected amount was not completely allocated'; end if;
  select l.amount-coalesce(sum(matched_amount),0) into bank_remaining from public.bank_reconciliation_matches where statement_line_id=p_line;
  update public.bank_statement_lines set status=case when bank_remaining=0 then 'matched' else 'unmatched' end,updated_at=now() where id=p_line;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,after_data,performed_by,reason)
    values(p_company,'payment_reconciliation',p_line,'reconciled',jsonb_build_object('bank_transaction_id',p_line,'allocations',links),p_actor,
      'Linked bank amount to existing verified payment portions only. Tenant invoice/payment/receipt unchanged.');
  return jsonb_build_object('bank_transaction_id',p_line,'allocations',links);
end;
$$;
