-- Preserve the existing classified portion of mixed receipts; default only
-- their unresolved remainder. Installing this function posts nothing.
create or replace function public.preview_historical_credit_classification(p_company uuid,p_bank uuid,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l record; rows jsonb:='[]'; reason text; ready numeric; allocated numeric; remaining numeric;
  ar uuid; current_day date:=(now() at time zone 'Asia/Kuala_Lumpur')::date; locked boolean;
begin
  perform public.assert_historical_credit_actor(p_company,p_bank,p_actor);
  select id into ar from public.accounting_accounts where company_id=p_company and system_key='rental_receivable'
    and code='1100' and account_type='asset' and is_active;
  if ar is null then raise exception 'historical_rental_receivable_missing'; end if;
  select exists(select 1 from public.accounting_periods where company_id=p_company and status='locked'
    and current_day between period_start and period_end) into locked;
  for l in select bl.*,s.period_start,s.status statement_status from public.bank_statement_lines bl
    join public.bank_statement_imports s on s.id=bl.statement_import_id
    where s.company_id=p_company and s.status<>'void' and bl.bank_account_id=p_bank
      and bl.transaction_date>=date '2026-03-01' and bl.transaction_date<date '2026-09-01'
      and bl.amount>0 and bl.duplicate_of_line_id is null order by bl.transaction_date,bl.id
  loop
    select coalesce(sum(matched_amount),0) into allocated from public.bank_reconciliation_matches where statement_line_id=l.id;
    remaining:=greatest(l.amount-allocated,0); reason:=null; ready:=0;
    if l.status in ('matched','adjusted','ignored') or remaining=0
      or exists(select 1 from public.historical_bank_credit_classifications where statement_line_id=l.id)
      then reason:='already_completed';
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
    else ready:=remaining;
    end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('id',l.id,'statement_id',l.statement_import_id,
      'date',l.transaction_date,'statement_month',to_char(l.period_start,'YYYY-MM'),'month',to_char(l.transaction_date,'YYYY-MM'),
      'description',l.description,'reference',l.reference_number,'amount',l.amount,'allocated',allocated,
      'remaining',remaining,'ready',ready,'new_ar_credit',ready,'reason',reason,
      'mode',case when ready>0 then 'historical_classification' else null end,'source_id',l.id));
  end loop;
  return jsonb_build_object('policy_version',2,'bank_id',p_bank,'account_code','1100','account_id',ar,
    'adjustment_date',current_day,'period_locked',locked,'rows',rows,
    'hash',md5('historical-v2.1'||rows::text||ar::text||current_day::text||locked::text));
end; $$;
