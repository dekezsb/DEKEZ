-- Accounting links only. Never recreate or update tenant payments/receipts/invoices.
-- Existing one-to-one routes remain guarded; new allocations consume a bounded
-- amount of an existing verified payment and bank line atomically. Either side
-- may retain a balance. Equality with an invoice/payment is NEVER required.
alter table public.bank_reconciliation_matches add column existing_payment_link boolean not null default false;
alter table public.accounting_payment_reconciliations drop constraint accounting_payment_reconciliations_bank_transaction_id_key;
alter table public.accounting_payment_reconciliations drop constraint accounting_payment_reconciliations_check;
alter table public.accounting_payment_reconciliations add constraint accounting_payment_reconciliations_link_status
  check (bank_transaction_id is null or reconciliation_status='RECONCILED');
create index accounting_payment_reconciliations_bank_idx on public.accounting_payment_reconciliations(bank_transaction_id);
create index if not exists bank_matches_payment_source_idx on public.bank_reconciliation_matches(source_id) where source_type='payment';

create or replace function public.guard_existing_payment_bank_match()
returns trigger language plpgsql security invoker set search_path='' as $$
declare p public.payments%rowtype; l public.bank_statement_lines%rowtype; company uuid; statement_month date;
  allocated numeric; bank_allocated numeric; location text[]; actual_property text; actual_room text;
begin
  select * into l from public.bank_statement_lines where id=new.statement_line_id;
  select company_id,date_trunc('month',period_start)::date into company,statement_month
    from public.bank_statement_imports where id=l.statement_import_id;
  perform pg_advisory_xact_lock(hashtextextended(company::text,1801));
  if tg_op='UPDATE' and (old.existing_payment_link or new.existing_payment_link) then
    raise exception 'Use audited unmatch before changing an existing payment allocation';
  end if;
  if l.amount>0 and exists(select 1 from public.bank_reconciliation_matches m where m.statement_line_id=l.id and m.id<>new.id
    and (not new.existing_payment_link or not m.existing_payment_link or m.source_type<>'payment')) then
    raise exception 'Possible duplicate transaction. Please review.';
  end if;
  if new.existing_payment_link and new.source_type<>'payment' then raise exception 'Existing payment required'; end if;
  if new.source_type='payment' then
    select * into p from public.payments where id=new.source_id for update;
    if p.id is null or p.company_id is distinct from company or p.status<>'confirmed' or p.reversed_at is not null
      or p.amount<=0 or l.amount<=0 or new.matched_amount<=0 then raise exception 'Existing confirmed payment required'; end if;
    if new.existing_payment_link then
      statement_month:=date_trunc('month',l.transaction_date)::date;
      if l.status<>'unmatched' or not exists(select 1 from public.bank_statement_imports where id=l.statement_import_id and status='in_progress') then
        raise exception 'Possible duplicate transaction. Please review.';
      end if;
      if exists(select 1 from public.bank_reconciliation_matches m where m.id<>new.id and m.source_type='payment' and m.source_id=p.id and not m.existing_payment_link) then
        raise exception 'Possible duplicate transaction. Please review.';
      end if;
      select coalesce(sum(m.matched_amount),0) into allocated from public.bank_reconciliation_matches m where m.source_type='payment' and m.source_id=p.id and m.id<>new.id;
      select coalesce(sum(m.matched_amount),0) into bank_allocated from public.bank_reconciliation_matches m where m.statement_line_id=l.id and m.id<>new.id;
      if allocated+new.matched_amount>p.amount or bank_allocated+new.matched_amount>l.amount then
        raise exception 'Allocation exceeds remaining verified payment or bank amount';
      end if;
      select upper(property_code) into actual_property from public.properties where id=p.property_id;
      select upper(regexp_replace(regexp_replace(room_number,'^ROOM\s*','','i'),'\s','','g')) into actual_room from public.rooms where id=p.room_id;
      actual_room:=regexp_replace(actual_room,'^0+(?=[0-9])','');
      for location in select regexp_matches(concat_ws(' ',l.reference_number,l.description),'\m(PTT|DGG|BDS|BVH|INS|HLT|KLB|SLY|MGT|SLS)\s*[-–—:/]?\s*(?:ROOM\s*)?([A-Z]?[0-9]+[A-Z]?)\M','gi') loop
        if upper(location[1]) is distinct from actual_property or regexp_replace(upper(location[2]),'^0+(?=[0-9])','') is distinct from actual_room then
          raise exception 'Bank property / room does not match the existing payment';
        end if;
      end loop;
    elsif l.amount<>p.amount or new.matched_amount<>p.amount then
      raise exception 'Select an existing confirmed payment with the same bank amount. No payment will be created.';
    end if;
    if date_trunc('month',p.payment_date)::date is distinct from statement_month then raise exception 'Payment must be from the same bank month'; end if;
    if p.rent_bill_id is not null and exists(select 1 from public.rent_bills b where b.id=p.rent_bill_id
      and date_trunc('month',b.bill_month)::date is distinct from statement_month) then raise exception 'Invoice must be from the same bank month'; end if;
    if exists(select 1 from public.bank_reconciliation_matches m where m.id<>new.id and (
      (m.source_type='rent_bill' and m.source_id=p.rent_bill_id) or
      (not new.existing_payment_link and m.source_type='payment' and m.source_id=p.id))) then
      raise exception 'Possible duplicate transaction. Please review.';
    end if;
    if exists(select 1 from public.bank_statement_lines other join public.bank_reconciliation_matches m on m.statement_line_id=other.id
      where other.id<>l.id and other.bank_account_id=l.bank_account_id and other.transaction_date=l.transaction_date and other.amount=l.amount
        and ((nullif(trim(l.reference_number),'') is not null and other.reference_number=l.reference_number)
          or (nullif(trim(l.description),'') is not null and other.description=l.description)))
      or exists(select 1 from public.payments other join public.bank_reconciliation_matches m on m.source_type='payment' and m.source_id=other.id
        where other.id<>p.id and other.company_id=p.company_id and other.amount=p.amount and other.payment_date=p.payment_date
          and nullif(trim(p.reference_number),'') is not null and other.reference_number=p.reference_number
          and (not new.existing_payment_link or p.payment_submission_id is null or other.payment_submission_id is distinct from p.payment_submission_id)) then
      raise exception 'Possible duplicate transaction. Please review.';
    end if;
  end if;
  return new;
end;
$$;

-- Deferred check: partial banks remain unmatched/in process. Only a zero bank
-- balance can be marked matched. No caller can hide a remaining amount.
create function public.check_existing_payment_bank_total()
returns trigger language plpgsql security invoker set search_path='' as $$
declare line_id uuid; total numeric; target numeric; line_status text;
begin
  line_id:=case when tg_op='DELETE' then old.statement_line_id else new.statement_line_id end;
  if (case when tg_op='DELETE' then old.existing_payment_link else new.existing_payment_link end) then
    select amount,status into target,line_status from public.bank_statement_lines where id=line_id;
    select coalesce(sum(matched_amount),0) into total from public.bank_reconciliation_matches where statement_line_id=line_id;
    if total<0 or total>target or (total=target and line_status<>'matched') or (total<target and line_status<>'unmatched') then
      raise exception 'Bank status must reflect its remaining allocation balance';
    end if;
  end if;
  return null;
end;
$$;
create constraint trigger check_existing_payment_bank_total after insert or update or delete on public.bank_reconciliation_matches
  deferrable initially deferred for each row execute function public.check_existing_payment_bank_total();

create function public.sync_existing_payment_link_state(p_payment uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.payments%rowtype; total numeric; sole_bank uuid; bank_count integer;
begin
  select * into p from public.payments where id=p_payment;
  select coalesce(sum(matched_amount),0),count(distinct statement_line_id),min(statement_line_id::text)::uuid
    into total,bank_count,sole_bank from public.bank_reconciliation_matches where source_type='payment' and source_id=p_payment;
  insert into public.accounting_payment_reconciliations(payment_record_id,company_id,bank_transaction_id,reconciliation_status,reconciled_at,reconciled_by)
    values(p.id,p.company_id,case when total=p.amount and bank_count=1 then sole_bank end,
      case when total=p.amount then 'RECONCILED' when total>0 then 'PENDING' else 'UNMATCHED' end,
      case when total=p.amount then now() end,case when total=p.amount then p_actor end)
    on conflict(payment_record_id) do update set bank_transaction_id=excluded.bank_transaction_id,reconciliation_status=excluded.reconciliation_status,
      reconciled_at=excluded.reconciled_at,reconciled_by=excluded.reconciled_by,updated_at=now();
end;
$$;

create function public.reconcile_existing_payment_allocation(p_company uuid,p_line uuid,p_payment uuid,p_actor uuid)
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
    or p.rent_bill_id is distinct from chosen.rent_bill_id or p.payment_date is distinct from chosen.payment_date)) then raise exception 'Inconsistent verified slip allocation'; end if;
  if exists(select 1 from public.bank_reconciliation_matches m where (m.source_type='payment' and m.source_id=any(ids) and not m.existing_payment_link)
    or (m.source_type='rent_bill' and m.source_id=chosen.rent_bill_id)) then raise exception 'Possible duplicate transaction. Please review.'; end if;
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

create function public.unreconcile_existing_payment_bank(p_company uuid,p_line uuid,p_actor uuid,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
declare ids uuid[]; payment_id uuid; old_links jsonb; statement_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
  if not exists(select 1 from public.profiles where id=p_actor and role in ('super_admin','admin')) or coalesce(length(trim(p_reason)),0)<3 then raise exception 'Authorized admin and reason required'; end if;
  select b.statement_import_id into statement_id from public.bank_statement_lines b join public.bank_statement_imports s on s.id=b.statement_import_id
    where b.id=p_line and s.company_id=p_company and s.status<>'void' for update of b;
  if statement_id is null or not exists(select 1 from public.bank_reconciliation_matches where statement_line_id=p_line and existing_payment_link)
    or exists(select 1 from public.bank_reconciliation_matches where statement_line_id=p_line and (not existing_payment_link or source_type<>'payment')) then raise exception 'Use the appropriate reviewed unmatch action'; end if;
  select array_agg(source_id),jsonb_agg(to_jsonb(m)) into ids,old_links from public.bank_reconciliation_matches m where statement_line_id=p_line;
  delete from public.bank_reconciliation_matches where statement_line_id=p_line;
  foreach payment_id in array ids loop perform public.sync_existing_payment_link_state(payment_id,p_actor); end loop;
  update public.bank_statement_lines set status='unmatched',updated_at=now() where id=p_line;
  update public.bank_statement_imports set status='in_progress',reconciled_at=null,reconciled_by=null,updated_at=now() where id=statement_id;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,reason,performed_by)
    values(p_company,'payment_reconciliation',p_line,'unmatched',jsonb_build_object('allocations',old_links),p_reason,p_actor);
end;
$$;

revoke all on function public.check_existing_payment_bank_total(), public.sync_existing_payment_link_state(uuid,uuid), public.reconcile_existing_payment_allocation(uuid,uuid,uuid,uuid), public.unreconcile_existing_payment_bank(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.sync_existing_payment_link_state(uuid,uuid), public.reconcile_existing_payment_allocation(uuid,uuid,uuid,uuid), public.unreconcile_existing_payment_bank(uuid,uuid,uuid,text) to service_role;
