-- Historical reconciliation only. No live cleanup is run by this migration.
-- An imported bank balance is NOT evidence that AR has not already been settled.
-- Therefore this batch links proven existing settlements and reclassifies only
-- a proven 1190 bank offset. Unknown/missing accounting sources fail closed.
create table public.historical_credit_runs (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  bank_account_id uuid not null references public.bank_accounts(id),
  actor_id uuid not null,
  preview_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.historical_credit_runs enable row level security;
revoke all on public.historical_credit_runs from public, anon, authenticated;
grant select, insert on public.historical_credit_runs to service_role;
create unique index historical_credit_journal_source_once on public.accounting_journal_entries(company_id,source_id)
  where source_type='historical_rental_credit';

-- Preserve the exact source of current-date reclassifications. A later
-- correction must be a separate audited adjustment, not an edited original.
create function public.protect_historical_credit_history()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='accounting_journal_entries' then
    if old.source_type='historical_rental_credit' then raise exception 'historical_immutable_adjustment'; end if;
  elsif tg_table_name='accounting_journal_lines' then
    if exists(select 1 from public.accounting_journal_entries where id=old.journal_entry_id and source_type='historical_rental_credit')
      then raise exception 'historical_immutable_adjustment'; end if;
    if tg_op='UPDATE' and exists(select 1 from public.accounting_journal_entries where id=new.journal_entry_id and source_type='historical_rental_credit')
      then raise exception 'historical_immutable_adjustment'; end if;
  elsif tg_table_name='bank_manual_transactions' then
    if exists(select 1 from public.accounting_journal_entries where source_id=old.id and source_type='historical_rental_credit')
      then raise exception 'historical_immutable_source'; end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
create trigger protect_historical_credit_journal before update or delete on public.accounting_journal_entries
  for each row execute function public.protect_historical_credit_history();
create trigger protect_historical_credit_journal_line before update or delete on public.accounting_journal_lines
  for each row execute function public.protect_historical_credit_history();
create trigger protect_historical_credit_source before update or delete on public.bank_manual_transactions
  for each row execute function public.protect_historical_credit_history();
revoke all on function public.protect_historical_credit_history() from public,anon,authenticated;
grant execute on function public.protect_historical_credit_history() to service_role;

create function public.assert_historical_credit_actor(p_company uuid,p_bank uuid,p_actor uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if p_actor is null or p_company is null or p_bank is null or not (
    exists(select 1 from public.profiles where id=p_actor and role::text in ('super_admin','admin'))
    or exists(select 1 from public.company_users where company_id=p_company
      and coalesce(user_id,profile_id)=p_actor and status::text='active' and role::text='owner')
  ) or not exists(select 1 from public.bank_accounts where id=p_bank and company_id=p_company and is_active)
  then raise exception 'historical_not_authorized'; end if;
  if exists(select 1 from public.user_module_permissions where profile_id=p_actor
    and module_key='reports' and access_level::text<>'manage')
    and not exists(select 1 from public.profiles where id=p_actor and role::text='super_admin')
  then raise exception 'historical_not_authorized'; end if;
end; $$;

create function public.historical_credit_reference_matches(p_reference text,p_bank_reference text)
returns boolean language sql immutable security invoker set search_path='' as $$
  select length(regexp_replace(coalesce(p_reference,''),'[^a-zA-Z0-9]','','g'))>=4
    and p_reference ~ '[0-9]'
    and upper(regexp_replace(p_reference,'[^a-zA-Z0-9]','','g'))=
        upper(regexp_replace(coalesce(p_bank_reference,''),'[^a-zA-Z0-9]','','g'));
$$;

create function public.preview_historical_rental_credits(p_company uuid,p_bank uuid,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare l record; p record; b record; part record; ids uuid[]; groups text[];
  rows jsonb:='[]'; entry jsonb; reason text; mode text; source uuid;
  allocated numeric; remaining numeric; available numeric; ready numeric;
  ar uuid; old_ar uuid; adjustment_date date:=(now() at time zone 'Asia/Kuala_Lumpur')::date;
begin
  perform public.assert_historical_credit_actor(p_company,p_bank,p_actor);
  select id into ar from public.accounting_accounts where company_id=p_company
    and system_key='rental_receivable' and code='1100' and account_type='asset' and is_active;
  select id into old_ar from public.accounting_accounts where company_id=p_company
    and system_key='other_receivable' and code='1190' and account_type='asset';
  if ar is null then raise exception 'historical_rental_receivable_missing'; end if;
  for l in select bl.*,s.status statement_status,s.period_start,s.period_end
    from public.bank_statement_lines bl join public.bank_statement_imports s on s.id=bl.statement_import_id
    where s.company_id=p_company and s.status<>'void' and bl.bank_account_id=p_bank
      and bl.transaction_date>=date '2026-03-01' and bl.transaction_date<date '2026-09-01'
      and bl.amount>0 and bl.duplicate_of_line_id is null order by bl.transaction_date,bl.id
  loop
    select coalesce(sum(matched_amount),0) into allocated from public.bank_reconciliation_matches where statement_line_id=l.id;
    remaining:=greatest(l.amount-allocated,0); reason:=null; mode:=null; source:=null; ready:=0; ids:=null;
    if l.status in ('matched','adjusted','ignored') or remaining=0 then reason:='already_completed';
    elsif l.statement_status<>'in_progress' then reason:='statement_closed';
    elsif concat_ws(' ',l.description,l.reference_number) ~* '\m(deposit|security|cagaran|refundable)\M'
      then reason:='security_or_mixed_deposit';
    elsif concat_ws(' ',l.description,l.reference_number) ~* '(\m(loan|director|shareholder|capital|refund|renovation|laveranda)\M|A/C\s+TSFR|CLOSE\s+CA|OWN\s+ACCOUNT|INTER.?BANK)'
      then reason:='transfer_or_non_rental';
    elsif exists(select 1 from public.bank_reconciliation_matches where statement_line_id=l.id and (not existing_payment_link or source_type<>'payment'))
      then reason:='existing_accounting_allocation';
    elsif exists(select 1 from public.bank_statement_lines d join public.bank_statement_imports ds on ds.id=d.statement_import_id
      where d.id<>l.id and ds.status<>'void' and d.duplicate_of_line_id is null and d.bank_account_id=l.bank_account_id
        and d.transaction_date=l.transaction_date and d.amount=l.amount and
        ((nullif(trim(l.reference_number),'') is not null and d.reference_number=l.reference_number) or d.description=l.description))
      then reason:='possible_duplicate_bank';
    end if;
    if reason is null then
      -- Automatic evidence discovery: no user tenant/room/receipt selection.
      -- Bare amount/date proximity never proves an existing settlement.
      select array_agg(distinct coalesce(pay.payment_submission_id::text,pay.id::text)),array_agg(pay.id order by pay.id)
        into groups,ids
      from public.payments pay
      left join public.tenancies tn on tn.id=pay.tenancy_id left join public.tenants t on t.id=tn.tenant_id
      left join public.properties pr on pr.id=pay.property_id left join public.rooms r on r.id=pay.room_id
      where pay.company_id=p_company and pay.status='confirmed' and pay.reversed_at is null
        and date_trunc('month',pay.payment_date)=date_trunc('month',l.transaction_date)
        and (pay.origin_bank_line_id=l.id
          or public.historical_credit_reference_matches(pay.reference_number,l.reference_number)
          or (length(trim(t.full_name))>=8 and strpos(' '||lower(regexp_replace(l.description,'[^[:alnum:]]+',' ','g'))||' ',
            ' '||lower(regexp_replace(trim(t.full_name),'[^[:alnum:]]+',' ','g'))||' ')>0)
          or exists(select 1 from regexp_matches(concat_ws(' ',l.reference_number,l.description),
            '\m(PTT|DGG|BDS|BVH|INS|HLT|KLB|SLY|MGT|SLS)\s*[-:/]?\s*(?:ROOM\s*)?([A-Z]?[0-9]+[A-Z]?)\M','gi') loc
            where upper(loc[1])=upper(pr.property_code) and upper(loc[2])=upper(r.room_number)));
      if cardinality(groups)>1 then reason:='ambiguous_existing_settlements';
      elsif cardinality(groups)=1 then
        select * into p from public.payments where id=ids[1];
        if p.payment_submission_id is not null then
          select array_agg(id order by id) into ids from public.payments where payment_submission_id=p.payment_submission_id and reversed_at is null;
        end if;
        -- Canonical group identity prevents different children of one slip
        -- being consumed by different rows within the same preview.
        source:=ids[1];
        available:=0;
        for part in select pay.*,rb.paid_amount,rb.bill_month,rb.removed_at from public.payments pay
          left join public.rent_bills rb on rb.id=pay.rent_bill_id where pay.id=any(ids) order by pay.id
        loop
          if part.category='deposit' then reason:='security_or_mixed_deposit'; exit; end if;
          if part.company_id is distinct from p_company or part.status is distinct from 'confirmed' or part.reversed_at is not null or coalesce(part.amount,0)<=0
            or coalesce(part.category,'') not in ('monthly_rent','electricity','damage','furniture','other','top_up_utilities')
            or part.rent_bill_id is null or part.removed_at is not null or part.paid_amount is null
            or date_trunc('month',part.bill_month) is distinct from date_trunc('month',l.transaction_date)
            or part.tenancy_id is distinct from p.tenancy_id or part.property_id is distinct from p.property_id
            or part.room_id is distinct from p.room_id or part.payment_date is distinct from p.payment_date
            or part.paid_amount < (select coalesce(sum(amount),0) from public.payments where rent_bill_id=part.rent_bill_id
              and status='confirmed' and reversed_at is null and category<>'deposit')
          then reason:='receivable_settlement_not_established'; exit; end if;
          if exists(select 1 from regexp_matches(concat_ws(' ',l.reference_number,l.description),
              '\m(PTT|DGG|BDS|BVH|INS|HLT|KLB|SLY|MGT|SLS)\s*[-–—:/]?\s*(?:ROOM\s*)?([A-Z]?[0-9]+[A-Z]?)\M','gi') loc
            where upper(loc[1]) is distinct from (select upper(property_code) from public.properties where id=part.property_id)
              or regexp_replace(upper(loc[2]),'^0+(?=[0-9])','') is distinct from
                (select regexp_replace(upper(regexp_replace(regexp_replace(room_number,'^ROOM\s*','','i'),'\s','','g')),'^0+(?=[0-9])','') from public.rooms where id=part.room_id))
          then reason:='conflicting_location_evidence'; exit; end if;
          if exists(select 1 from public.bank_reconciliation_matches where
            (source_type='payment' and source_id=part.id and not existing_payment_link)
            or (source_type='rent_bill' and source_id=part.rent_bill_id))
          then reason:='existing_accounting_allocation'; exit; end if;
          available:=available+greatest(part.amount-coalesce((select sum(matched_amount) from public.bank_reconciliation_matches
            where source_type='payment' and source_id=part.id),0),0);
        end loop;
        if p.payment_submission_id is not null and not exists(select 1 from public.payment_submissions
          where id=p.payment_submission_id and verification_status='verified') then reason:='unverified_source'; end if;
        if reason is null then
          if available<=0 then reason:='settlement_already_fully_linked';
          else mode:='existing_payment'; ready:=least(remaining,available); end if;
        end if;
      else
        -- Existing offset is the only permitted basis for a new balanced
        -- reclassification. Never manufacture a debit to Bank or suspense.
        select array_agg(bt.id order by bt.id) into ids from public.bank_manual_transactions bt
          where bt.company_id=p_company and bt.bank_account_id=p_bank and bt.transaction_date=l.transaction_date
            and bt.amount=remaining and bt.amount>0
            and public.historical_credit_reference_matches(bt.reference_number,l.reference_number);
        if cardinality(ids)=1 and allocated=0 then
          select * into b from public.bank_manual_transactions where id=ids[1];
          if not coalesce(b.offset_account_id=ar or b.offset_account_id=old_ar,false) then reason:='non_rental_offset';
          elsif exists(select 1 from public.bank_reconciliation_matches where source_type='manual_bank_transaction' and source_id=b.id)
            or exists(select 1 from public.accounting_journal_entries where source_id=b.id and status='posted')
          then reason:='existing_accounting_allocation';
          elsif b.description ~* '(\m(deposit|security|cagaran|refundable|loan|director|shareholder|capital|refund|renovation|laveranda)\M|A/C\s+TSFR|CLOSE\s+CA|OWN\s+ACCOUNT|INTER.?BANK)' then reason:='protected_offset';
          else source:=b.id; ready:=remaining; mode:=case when b.offset_account_id=ar then 'existing_ar_offset' else 'reclassify_other_ar' end;
          end if;
        else reason:='accounting_source_not_established'; end if;
      end if;
    end if;
    if mode='reclassify_other_ar' and exists(select 1 from public.accounting_periods where company_id=p_company
      and status='locked' and adjustment_date between period_start and period_end) then reason:='current_adjustment_period_locked'; end if;
    if reason is not null then mode:=null; ready:=0; end if;
    entry:=jsonb_build_object('id',l.id,'statement_id',l.statement_import_id,'date',l.transaction_date,
      'statement_month',to_char(l.period_start,'YYYY-MM'),'month',to_char(l.transaction_date,'YYYY-MM'),
      'description',l.description,'reference',l.reference_number,'amount',l.amount,'allocated',allocated,
      'remaining',remaining,'ready',ready,'mode',mode,'source_id',source,'payment_ids',case when mode='existing_payment' then to_jsonb(ids) else '[]'::jsonb end,
      'new_ar_credit',case when mode='reclassify_other_ar' then ready else 0 end,'reason',reason);
    rows:=rows||jsonb_build_array(entry);
  end loop;
  -- Do not consume the same source twice within one preview, even if two
  -- statement lines independently appear to identify it.
  select coalesce(jsonb_agg(case when e->>'mode' is not null and
    (select count(*) from jsonb_array_elements(rows) x where x->>'mode' is not null and x->>'source_id'=e->>'source_id')>1
    then e||jsonb_build_object('mode',null,'ready',0,'new_ar_credit',0,'reason','source_claimed_by_multiple_banks') else e end
    order by e->>'date',e->>'id'),'[]') into rows from jsonb_array_elements(rows) e;
  return jsonb_build_object('bank_id',p_bank,'account_code','1100','account_id',ar,'old_account_id',old_ar,
    'adjustment_date',adjustment_date,'rows',rows,'hash',md5(rows::text||ar::text||coalesce(old_ar::text,'')||adjustment_date::text));
end; $$;

create function public.clear_historical_rental_credits(p_company uuid,p_bank uuid,p_actor uuid,p_run uuid,p_hash text)
returns jsonb language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare preview jsonb; prior public.historical_credit_runs; e jsonb; line public.bank_statement_lines;
  bt public.bank_manual_transactions; journal uuid; result jsonb; n integer:=0; total numeric:=0; new_credit numeric:=0;
  current_day date:=(now() at time zone 'Asia/Kuala_Lumpur')::date; st record; closed_ids jsonb:='[]';
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
  -- Stable source snapshot while planning and applying. These locks do not
  -- modify tenant, invoice, payment, debit or historical journal records.
  lock table public.payments,public.payment_submissions,public.rent_bills,public.bank_manual_transactions,
    public.accounting_periods,public.accounting_accounts in share mode;
  -- Other journal writers do not all take the reconciliation advisory lock.
  -- Serialize the short classification transaction against those writers too.
  lock table public.accounting_journal_entries in share row exclusive mode;
  perform 1 from public.bank_statement_imports where company_id=p_company and bank_account_id=p_bank order by id for update;
  perform 1 from public.bank_statement_lines where bank_account_id=p_bank and amount>0
    and transaction_date>=date '2026-03-01' and transaction_date<date '2026-09-01' order by id for update;
  preview:=public.preview_historical_rental_credits(p_company,p_bank,p_actor);
  if preview->>'hash'<>p_hash then raise exception 'historical_preview_changed'; end if;
  for e in select value from jsonb_array_elements(preview->'rows') where value->>'mode' is not null loop
    select * into line from public.bank_statement_lines where id=(e->>'id')::uuid;
    if e->>'mode'='existing_payment' then
      perform public.reconcile_existing_payment_allocation(p_company,line.id,(e->>'source_id')::uuid,p_actor);
    else
      select * into bt from public.bank_manual_transactions where id=(e->>'source_id')::uuid;
      if e->>'mode'='reclassify_other_ar' then
        journal:=gen_random_uuid();
        insert into public.accounting_journal_entries(id,company_id,entry_date,entry_number,source_type,source_id,
          reference_number,description,status,posted_at,created_by)
        values(journal,p_company,current_day,'HRC-'||journal::text,'historical_rental_credit',bt.id,
          line.reference_number,'Historical receivable reclassification: bank '||line.transaction_date::text||' / '||line.id::text,'posted',now(),p_actor);
        insert into public.accounting_journal_lines(journal_entry_id,account_id,property_id,description,debit,credit) values
          (journal,bt.offset_account_id,bt.property_id,'Reverse existing Other Tenant Receivables offset; original bank unchanged',(e->>'ready')::numeric,0),
          (journal,(preview->>'account_id')::uuid,bt.property_id,'Classify historical rental settlement to 1100',0,(e->>'ready')::numeric);
        new_credit:=new_credit+(e->>'ready')::numeric;
      end if;
      insert into public.bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,match_method,created_by)
        values(line.id,'manual_bank_transaction',bt.id,(e->>'ready')::numeric,'manual',p_actor);
      update public.bank_statement_lines set status='matched',updated_at=now() where id=line.id and amount>0;
    end if;
    insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,performed_by,reason)
      values(p_company,'historical_rental_credit',line.id,'cleared',to_jsonb(line),
        e||jsonb_build_object('run_id',p_run,'adjustment_date',current_day,'account_id',preview->'account_id',
          'old_account_id',case when e->>'mode'='reclassify_other_ar' then preview->'old_account_id' else preview->'account_id' end),
        p_actor,'Approved March-August historical batch. Existing Bank and income unchanged; no new payment, receipt or invoice.');
    n:=n+1; total:=total+(e->>'ready')::numeric;
  end loop;
  -- Only touched statements may complete; read Debit but never update it.
  for st in select s.* from public.bank_statement_imports s where s.company_id=p_company and s.bank_account_id=p_bank
    and s.status='in_progress' and s.id in (select (value->>'statement_id')::uuid from jsonb_array_elements(preview->'rows') where value->>'mode' is not null)
  loop
    if not exists(select 1 from public.bank_statement_transactions where statement_import_id=st.id
      and status not in ('matched','adjusted','ignored'))
      and abs(st.opening_balance+coalesce((select sum(amount) from public.bank_statement_transactions where statement_import_id=st.id),0)-st.closing_balance)<0.005
    then
      update public.bank_statement_imports set status='reconciled',reconciled_by=p_actor,reconciled_at=now(),updated_at=now() where id=st.id;
      closed_ids:=closed_ids||jsonb_build_array(st.id);
      insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,performed_by,reason)
        values(p_company,'bank_statement',st.id,'historical_completed',to_jsonb(st),jsonb_build_object('status','reconciled','run_id',p_run),p_actor,
          'No remaining Money In or Money Out; movement agrees. No debit allocations changed.');
    end if;
  end loop;
  result:=jsonb_build_object('run_id',p_run,'cleared_count',n,'cleared_amount',total,'new_ar_credit',new_credit,'completed_statements',closed_ids);
  insert into public.historical_credit_runs(id,company_id,bank_account_id,actor_id,preview_hash,result)
    values(p_run,p_company,p_bank,p_actor,p_hash,result);
  return result;
end; $$;

revoke all on function public.assert_historical_credit_actor(uuid,uuid,uuid),
  public.historical_credit_reference_matches(text,text),public.preview_historical_rental_credits(uuid,uuid,uuid),
  public.clear_historical_rental_credits(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.assert_historical_credit_actor(uuid,uuid,uuid),
  public.historical_credit_reference_matches(text,text),public.preview_historical_rental_credits(uuid,uuid,uuid),
  public.clear_historical_rental_credits(uuid,uuid,uuid,uuid,text) to service_role;
