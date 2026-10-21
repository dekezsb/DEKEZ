-- September exception is an immutable allowlist of the 37 source IDs audited
-- 2026-10-22 (MYT), NOT a new date-wide matching policy. Installation posts nothing.
create table public.september_credit_cleanup_scope (
  statement_line_id uuid primary key references public.bank_statement_lines(id),
  company_id uuid not null references public.companies(id),
  bank_account_id uuid not null references public.bank_accounts(id),
  captured_remaining numeric(14,2) not null check(captured_remaining>0),
  source_snapshot jsonb not null,
  captured_at timestamptz not null default now()
);
alter table public.september_credit_cleanup_scope enable row level security;
revoke all on public.september_credit_cleanup_scope from public,anon,authenticated,service_role;
grant select on public.september_credit_cleanup_scope to service_role;
-- IDs below identify existing bank sources; no generated IDs or financial rows.
-- The audited manifest is installed separately as deployment configuration,
-- after schema installation and before release. No generated IDs are embedded
-- in this schema migration. There is no public/service API to expand the scope.

create function public.guard_september_credit_scope()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='september_credit_cleanup_scope' then raise exception 'september_scope_immutable'; end if;
  if new.original_bank_date>=date '2026-09-01' and not exists(
    select 1 from public.september_credit_cleanup_scope s
    where s.statement_line_id=new.statement_line_id and s.company_id=new.company_id and s.bank_account_id=new.bank_account_id
      and new.original_bank_date=(s.source_snapshot->>'transaction_date')::date
      and new.amount<=s.captured_remaining
      and new.source_snapshot->>'classification_policy'='management_september_frozen_leftovers'
  ) then raise exception 'september_source_not_authorized'; end if;
  return new;
end; $$;
create trigger september_scope_immutable before update or delete on public.september_credit_cleanup_scope
  for each row execute function public.guard_september_credit_scope();
alter table public.historical_bank_credit_classifications
  drop constraint historical_bank_credit_classifications_original_bank_date_check;
alter table public.historical_bank_credit_classifications add constraint historical_bank_credit_classifications_original_bank_date_check
  check(original_bank_date>=date '2026-03-01' and original_bank_date<date '2026-10-01');
create trigger historical_september_scope_required before insert on public.historical_bank_credit_classifications
  for each row execute function public.guard_september_credit_scope();

create function public.preview_september_credit_cleanup(p_company uuid,p_bank uuid,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l record; rows jsonb:='[]'; reason text; ready numeric; allocated numeric; remaining numeric;
  accounted numeric; existing_receipts jsonb;
  ar uuid; current_day date:=(now() at time zone 'Asia/Kuala_Lumpur')::date; locked boolean;
begin
  perform public.assert_historical_credit_actor(p_company,p_bank,p_actor);
  select id into ar from public.accounting_accounts where company_id=p_company and system_key='rental_receivable'
    and code='1100' and account_type='asset' and is_active;
  if ar is null then raise exception 'historical_rental_receivable_missing'; end if;
  select exists(select 1 from public.accounting_periods where company_id=p_company and status='locked'
    and current_day between period_start and period_end) into locked;
  for l in select bl.*,s.period_start,s.status statement_status,scope.source_snapshot,scope.captured_remaining from public.bank_statement_lines bl
    join public.bank_statement_imports s on s.id=bl.statement_import_id
    join public.september_credit_cleanup_scope scope on scope.statement_line_id=bl.id and scope.company_id=p_company and scope.bank_account_id=p_bank
    where s.company_id=p_company and s.status<>'void' and bl.bank_account_id=p_bank
      and bl.transaction_date>=date '2026-09-01' and bl.transaction_date<date '2026-10-01'
      and bl.amount>0 and bl.duplicate_of_line_id is null order by bl.transaction_date,bl.id
  loop
    select coalesce(sum(matched_amount),0) into allocated from public.bank_reconciliation_matches where statement_line_id=l.id;
    remaining:=greatest(l.amount-allocated,0); reason:=null; ready:=0;
    -- Existing recorded settlements can be split across several payments, dated
    -- a few days before the bank value date, or partly allocated. Never assume
    -- absence of one equal-amount payment means the receivable was not reduced.
    select coalesce(jsonb_agg(to_jsonb(receipt) order by receipt.id), '[]'),
      least(remaining,coalesce(sum(receipt.available),0))
      into existing_receipts,accounted
    from (
      select p.id,p.category,p.amount,p.payment_date,p.reference_number,
        greatest(p.amount-coalesce((select sum(m.matched_amount) from public.bank_reconciliation_matches m
          where m.source_type='payment' and m.source_id=p.id),0),0) available
      from public.payments p where p.company_id=p_company and p.status='confirmed' and p.reversed_at is null
        and (p.origin_bank_line_id=l.id or (
          p.payment_date>=date '2026-09-01' and p.payment_date<date '2026-10-01'
          and public.historical_credit_reference_matches(p.reference_number,l.reference_number)))
    ) receipt where receipt.available>0;
    if l.status in ('matched','adjusted','ignored') or remaining=0
      or exists(select 1 from public.historical_bank_credit_classifications where statement_line_id=l.id)
      then reason:='already_completed';
    elsif l.amount<>(l.source_snapshot->>'amount')::numeric or l.transaction_date<>(l.source_snapshot->>'transaction_date')::date
      or l.statement_import_id<>(l.source_snapshot->>'statement_import_id')::uuid
      or l.reference_number is distinct from l.source_snapshot->>'reference_number'
      or l.description is distinct from l.source_snapshot->>'description'
      or remaining>l.captured_remaining then reason:='source_changed';
    elsif l.statement_status<>'in_progress' then reason:='statement_closed';
    -- Only persisted accounting links/categories count. No description keyword,
    -- tenant/room matching, confidence, missing-proof or fuzzy-duplicate rules.
    -- Existing allocations, including security deposits, were subtracted above.
    -- Their category does not classify the unallocated remainder of a mixed receipt.
    elsif exists(select 1 from public.bank_account_transfers t where t.company_id=p_company and t.to_bank_account_id=p_bank
      and (t.to_statement_line_id=l.id or (t.transfer_date=l.transaction_date and t.amount=l.amount
        and public.historical_credit_reference_matches(t.reference_number,l.reference_number))))
      then reason:='known_other_category';
    elsif exists(select 1 from public.payments p where p.company_id=p_company
      and (p.origin_bank_line_id=l.id or (p.payment_date=l.transaction_date and p.amount=l.amount
        and public.historical_credit_reference_matches(p.reference_number,l.reference_number)))
      and p.status='confirmed' and p.reversed_at is null and p.category='deposit')
      then reason:='known_security_liability';
    elsif exists(select 1 from public.accounting_journal_entries j
      join public.accounting_journal_lines jl on jl.journal_entry_id=j.id
      join public.accounting_accounts a on a.id=jl.account_id
      where j.company_id=p_company and j.status='posted' and j.source_id=l.id and jl.credit>0 and a.id<>ar)
      then reason:='known_other_category';
    elsif exists(select 1 from public.bank_manual_transactions b where b.company_id=p_company and b.bank_account_id=p_bank
      and b.transaction_date=l.transaction_date and b.amount=l.amount and b.offset_account_id<>ar
      and public.historical_credit_reference_matches(b.reference_number,l.reference_number))
      then reason:='known_other_category';
    elsif exists(select 1 from public.accounting_journal_entries j join public.accounting_journal_lines jl on jl.journal_entry_id=j.id
      where j.company_id=p_company and j.status='posted' and j.source_id=l.id and jl.account_id=ar and jl.credit>0)
      or exists(select 1 from public.bank_manual_transactions b where b.company_id=p_company and b.bank_account_id=p_bank
        and b.transaction_date=l.transaction_date and b.amount=l.amount and b.offset_account_id=ar
        and public.historical_credit_reference_matches(b.reference_number,l.reference_number))
      or exists(select 1 from public.payments p where p.company_id=p_company
        and (p.origin_bank_line_id=l.id or (p.payment_date=l.transaction_date and p.amount=l.amount
          and public.historical_credit_reference_matches(p.reference_number,l.reference_number)))
        and p.status='confirmed' and p.reversed_at is null and p.category<>'deposit')
      then reason:='already_accounted';
    elsif accounted>0 then
      reason:=case when exists(select 1 from jsonb_array_elements(existing_receipts) where value->>'category'='deposit')
        then 'known_security_liability' else 'already_accounted' end;
    else ready:=remaining;
    end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('id',l.id,'statement_id',l.statement_import_id,
      'date',l.transaction_date,'statement_month',to_char(l.period_start,'YYYY-MM'),'month',to_char(l.transaction_date,'YYYY-MM'),
      'description',l.description,'reference',l.reference_number,'amount',l.amount,'allocated',allocated,
      'remaining',remaining,'ready',ready,'new_ar_credit',ready,'reason',reason,
      'existing_receipts',existing_receipts,'existing_accounted_amount',accounted,
      'mode',case when ready>0 then 'historical_classification' else null end,'source_id',l.id));
  end loop;
  return jsonb_build_object('policy_version',3,'bank_id',p_bank,'account_code','1100','account_id',ar,
    'adjustment_date',current_day,'period_locked',locked,'rows',rows,
    'hash',md5('september-frozen-v1'||rows::text||ar::text||current_day::text||locked::text));
end; $$;


create function public.clear_september_credit_cleanup(p_company uuid,p_bank uuid,p_actor uuid,p_run uuid,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare preview jsonb; prior public.historical_credit_runs; e jsonb; line public.bank_statement_lines;
  result jsonb; n integer:=0; total numeric:=0; st record; closed_ids jsonb:='[]';
  current_day date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  perform public.assert_historical_credit_actor(p_company,p_bank,p_actor);
  if p_run is null or nullif(p_hash,'') is null then raise exception 'historical_confirmation_required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
  select * into prior from public.historical_credit_runs where id=p_run;
  if found then
    if prior.company_id<>p_company or prior.bank_account_id<>p_bank or prior.actor_id<>p_actor or prior.preview_hash<>p_hash
      then raise exception 'historical_request_conflict'; end if;
    return prior.result;
  end if;
  lock table public.payments,public.bank_manual_transactions,public.bank_account_transfers,public.accounting_periods,public.accounting_accounts in share mode;
  lock table public.accounting_journal_entries,public.accounting_journal_lines,public.bank_reconciliation_matches in share mode;
  perform 1 from public.bank_statement_imports where company_id=p_company and bank_account_id=p_bank order by id for update;
  perform 1 from public.bank_statement_lines where bank_account_id=p_bank and amount>0
    and id in (select statement_line_id from public.september_credit_cleanup_scope where company_id=p_company and bank_account_id=p_bank) order by id for update;
  preview:=public.preview_september_credit_cleanup(p_company,p_bank,p_actor);
  if preview->>'hash'<>p_hash then raise exception 'historical_preview_changed'; end if;
  if exists(select 1 from jsonb_array_elements(preview->'rows') where value->>'reason'='source_changed') then raise exception 'september_source_changed'; end if;
  if (preview->>'period_locked')::boolean then raise exception 'historical_current_period_locked'; end if;
  for e in select value from jsonb_array_elements(preview->'rows') where (value->>'ready')::numeric>0 loop
    select * into line from public.bank_statement_lines where id=(e->>'id')::uuid;
    -- Updating status first lets the immutable-source trigger protect the final
    -- source snapshot. Both changes commit atomically or neither is retained.
    update public.bank_statement_lines set status='adjusted',updated_at=now() where id=line.id;
    insert into public.historical_bank_credit_classifications(company_id,bank_account_id,statement_line_id,account_id,amount,
      classification_date,original_bank_date,original_statement_month,reference_number,description,source_snapshot,run_id,created_by)
    values(p_company,p_bank,line.id,(preview->>'account_id')::uuid,(e->>'ready')::numeric,current_day,
      line.transaction_date,((e->>'statement_month')||'-01')::date,line.reference_number,line.description,
      to_jsonb(line)||jsonb_build_object('previous_allocated',e->'allocated','existing_receipts',e->'existing_receipts',
        'existing_accounted_amount',e->'existing_accounted_amount','classification_policy','management_september_frozen_leftovers'),p_run,p_actor);
    insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,performed_by,reason)
    values(p_company,'historical_rental_credit',line.id,'classified',to_jsonb(line),
      e||jsonb_build_object('run_id',p_run,'classification_date',current_day,'account_id',preview->'account_id','old_account_id',null),
      p_actor,'Approved frozen September leftovers: existing imported Bank unchanged; missing offset classified to 1100. No new journal, income, payment, receipt or invoice.');
    n:=n+1; total:=total+(e->>'ready')::numeric;
  end loop;
  for st in select s.* from public.bank_statement_imports s where s.company_id=p_company and s.bank_account_id=p_bank
    and s.status='in_progress' and s.id in (select (value->>'statement_id')::uuid from jsonb_array_elements(preview->'rows') where (value->>'ready')::numeric>0)
  loop
    if not exists(select 1 from public.bank_statement_transactions where statement_import_id=st.id and amount<>0
      and status not in ('matched','adjusted','ignored'))
      and abs(st.opening_balance+coalesce((select sum(amount) from public.bank_statement_transactions where statement_import_id=st.id),0)-st.closing_balance)<0.005 then
      update public.bank_statement_imports set status='reconciled',reconciled_by=p_actor,reconciled_at=now(),updated_at=now() where id=st.id;
      closed_ids:=closed_ids||jsonb_build_array(st.id);
      insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,performed_by,reason)
      values(p_company,'bank_statement',st.id,'historical_completed',to_jsonb(st),jsonb_build_object('status','reconciled','run_id',p_run),p_actor,
        'Both sides complete; existing Debit transactions and allocations unchanged.');
    end if;
  end loop;
  result:=jsonb_build_object('policy_version',3,'run_id',p_run,'cleared_count',n,'cleared_amount',total,'new_ar_credit',total,'completed_statements',closed_ids);
  insert into public.historical_credit_runs(id,company_id,bank_account_id,actor_id,preview_hash,result) values(p_run,p_company,p_bank,p_actor,p_hash,result);
  return result;
end; $$;
revoke all on function public.guard_september_credit_scope(),public.preview_september_credit_cleanup(uuid,uuid,uuid),
public.clear_september_credit_cleanup(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.guard_september_credit_scope(),public.preview_september_credit_cleanup(uuid,uuid,uuid),
public.clear_september_credit_cleanup(uuid,uuid,uuid,uuid,text) to service_role;
