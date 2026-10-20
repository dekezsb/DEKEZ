-- Existing, bank-confirmed renovation receipts are linked, never paid again.
-- No rental tables, journal entries or reconciliation matches are changed.
alter table public.renovation_payment_submissions
  add column receipt_origin text not null default 'upload'
    check (receipt_origin in ('upload','existing_bank'));
alter table public.renovation_payment_submissions
  alter column proof_path drop not null,
  alter column proof_sha256 drop not null;
alter table public.renovation_payment_submissions add constraint renovation_receipt_evidence check (
  (receipt_origin='upload' and proof_path is not null and length(proof_path)>0 and proof_sha256 is not null)
  or (receipt_origin='existing_bank' and proof_path is null and proof_sha256 is null
    and admin_uploaded and status='verified' and bank_transaction_id is not null)
);

-- Extend the existing proof guard only for bank-confirmed historical receipts.
-- Keep all upload rules and immutable history checks intact.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.guard_renovation_payment_proof()'::regprocedure);
  definition:=regexp_replace(definition,'begin[[:space:]]*', $branch$begin
  if new.receipt_origin='existing_bank' then
    if tg_op<>'INSERT' then raise exception 'Existing renovation bank receipt links are immutable'; end if;
    perform public.assert_renovation_actor(new.company_id,new.submitted_by);
    select * into d from public.renovation_documents
      where id=new.invoice_id and company_id=new.company_id for update;
    if d.id is null or d.kind<>'invoice' or d.status<>'issued'
      or new.status<>'verified' or not new.admin_uploaded
      or new.verified_by is distinct from new.submitted_by or new.verified_at is null
      or new.amount>d.total-coalesce((select sum(amount) from public.renovation_payment_submissions
        where invoice_id=d.id and status='verified'),0)
      or not exists(select 1 from public.bank_manual_transactions b
        join public.accounting_accounts a on a.id=b.offset_account_id
        where b.id=new.bank_transaction_id and b.company_id=new.company_id
          and b.bank_account_id=new.bank_account_id and b.amount=new.amount and b.amount>0
          and b.transaction_date=new.payment_date and b.reference_number=new.reference_number
          and b.property_id is null and a.company_id=new.company_id
          and a.system_key='renovation_receivable' and a.account_type='asset' and a.is_active
          and b.amount=(select coalesce(sum(m.matched_amount),0) from public.bank_reconciliation_matches m
            where m.source_type='manual_bank_transaction' and m.source_id=b.id))
      then raise exception 'renovation_existing_receipt_invalid'; end if;
    return new;
  end if;
  if tg_op='UPDATE' and old.receipt_origin='existing_bank' then
    raise exception 'Existing renovation bank receipt links are immutable';
  end if;
  $branch$);
  execute definition;
end; $migration$;

create function public.link_existing_renovation_receipts(
  p_company uuid,p_actor uuid,p_invoice uuid,p_receipts jsonb,p_reason text
) returns integer language plpgsql security invoker set search_path='' as $$
declare d public.renovation_documents; b public.bank_manual_transactions; existing public.renovation_payment_submissions;
  ar uuid; income uuid; request jsonb; linked integer:=0; paid numeric; before_row jsonb; after_row jsonb; link_id uuid;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  if jsonb_typeof(p_receipts) is distinct from 'array'
    or jsonb_array_length(p_receipts) not between 1 and 20
    or coalesce(length(btrim(p_reason)),0) not between 10 and 1000 then raise exception 'renovation_link_details'; end if;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_receipts)x)<>jsonb_array_length(p_receipts)
    then raise exception 'renovation_link_duplicates'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text||':renovation_existing_receipts',0));
  select * into d from public.renovation_documents where id=p_invoice and company_id=p_company for update;
  if not found or d.kind<>'invoice' or d.status<>'issued' then raise exception 'renovation_invoice_required'; end if;
  select id into ar from public.accounting_accounts where company_id=p_company
    and system_key='renovation_receivable' and account_type='asset' and is_active;
  select id into income from public.accounting_accounts where company_id=p_company
    and code='4050' and name='Renovation Service Income' and account_type='income' and is_active;
  if ar is null or income is null then raise exception 'renovation_receivable_required'; end if;
  for request in select value from jsonb_array_elements(p_receipts) order by value->>'id' loop
    select * into b from public.bank_manual_transactions where id=(request->>'id')::uuid and company_id=p_company for update;
    if not found then raise exception 'renovation_existing_receipt_invalid'; end if;
    select * into existing from public.renovation_payment_submissions where bank_transaction_id=b.id;
    if found then
      if existing.company_id=p_company and existing.invoice_id=d.id and existing.status='verified'
        and existing.receipt_origin='existing_bank' then continue; end if;
      raise exception 'renovation_payment_already_recorded';
    end if;
    if (request->>'version')::integer is distinct from b.correction_version then raise exception 'renovation_receipt_stale'; end if;
    if b.amount<=0 or b.property_id is not null or b.offset_account_id not in (ar,income)
      or length(btrim(coalesce(b.reference_number,''))) not between 3 and 120
      or not exists(select 1 from public.bank_accounts where id=b.bank_account_id and company_id=p_company)
      then raise exception 'renovation_existing_receipt_invalid'; end if;
    perform 1 from public.accounting_periods where company_id=p_company
      and b.transaction_date between period_start and period_end for share;
    if exists(select 1 from public.accounting_periods where company_id=p_company and status='locked'
      and b.transaction_date between period_start and period_end) then raise exception 'renovation_period_locked'; end if;
    -- A completed existing bank receipt is required; never guess from amount/date.
    perform 1 from public.bank_reconciliation_matches where source_type='manual_bank_transaction' and source_id=b.id for update;
    if b.amount<>(select coalesce(sum(matched_amount),0) from public.bank_reconciliation_matches
      where source_type='manual_bank_transaction' and source_id=b.id)
      or exists(select 1 from public.bank_reconciliation_matches m
        left join public.bank_statement_lines l on l.id=m.statement_line_id
        left join public.bank_statement_imports s on s.id=l.statement_import_id
        where m.source_type='manual_bank_transaction' and m.source_id=b.id
          and (l.id is null or s.company_id is distinct from p_company or l.bank_account_id<>b.bank_account_id
            or l.amount<=0 or l.status='ignored' or l.duplicate_of_line_id is not null))
      then raise exception 'renovation_bank_receipt_not_confirmed'; end if;
    select coalesce(sum(amount),0) into paid from public.renovation_payment_submissions where invoice_id=d.id and status='verified';
    if b.amount>d.total-paid then raise exception 'renovation_overpayment'; end if;
    before_row:=to_jsonb(b);
    if b.offset_account_id<>ar then
      update public.bank_manual_transactions set offset_account_id=ar,correction_version=correction_version+1
        where id=b.id returning to_jsonb(bank_manual_transactions.*) into after_row;
      insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
      values(p_company,'bank_manual_transaction',b.id,'posting_corrected',before_row,after_row,
        'Existing renovation receipt reclassified from income to receivables. '||btrim(p_reason),p_actor);
    else after_row:=before_row; end if;
    link_id:=gen_random_uuid();
    -- This row is an invoice association to the SAME bank receipt, not a new
    -- financial transaction. No verify/upload/posting routine is called.
    insert into public.renovation_payment_submissions(id,company_id,invoice_id,bank_account_id,amount,payment_date,
      reference_number,proof_path,proof_sha256,status,bank_transaction_id,submitted_by,admin_uploaded,verified_by,verified_at,receipt_origin)
    values(link_id,p_company,d.id,b.bank_account_id,b.amount,b.transaction_date,b.reference_number,null,null,
      'verified',b.id,p_actor,true,p_actor,now(),'existing_bank');
    insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
    values(p_company,'renovation_payment',link_id,'existing_bank_receipt_linked',before_row,
      jsonb_build_object('invoice_id',d.id,'bank_transaction_id',b.id,'amount',b.amount,
        'payment_date',b.transaction_date,'reference_number',b.reference_number,'receipt',after_row,
        'preserved_matches',(select jsonb_agg(to_jsonb(m)) from public.bank_reconciliation_matches m
          where source_type='manual_bank_transaction' and source_id=b.id)),
      btrim(p_reason)||' No new payment, receipt, journal or bank match created. No slip upload required.',p_actor);
    linked:=linked+1;
  end loop;
  return linked;
end; $$;
revoke all on function public.link_existing_renovation_receipts(uuid,uuid,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.link_existing_renovation_receipts(uuid,uuid,uuid,jsonb,text) to service_role;
