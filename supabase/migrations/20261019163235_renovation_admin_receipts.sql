-- Existing renovation uploads were exclusively staff-side. Preserve every
-- financial field and identify their origin without replaying verification.
alter table public.renovation_payment_submissions add column admin_uploaded boolean not null default true;
alter table public.renovation_payment_submissions alter column admin_uploaded set default false;
alter table public.renovation_payment_submissions drop constraint renovation_payment_submissions_reference_number_check;
alter table public.renovation_payment_submissions add constraint renovation_payment_reference_valid
  check (length(btrim(reference_number)) between 3 and 120 or (admin_uploaded and reference_number=''));

-- Preserve the existing guards, adding only an audited missing-reference fill.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.guard_renovation_payment_proof()'::regprocedure);
  definition:=replace(definition,'if tg_op=''UPDATE'' then', $code$if tg_op='UPDATE' then
    if old.admin_uploaded and old.reference_number='' and new.status='verified'
      and length(btrim(new.reference_number)) between 3 and 120
      and length(regexp_replace(new.reference_number,'[^a-zA-Z0-9]','','g'))>=3
      and (to_jsonb(new)-'reference_number')=(to_jsonb(old)-'reference_number') then return new; end if;$code$);
  definition:=replace(definition,'or length(regexp_replace(new.reference_number,''[^a-zA-Z0-9]'','''',''g''))<3',
    'or (length(regexp_replace(new.reference_number,''[^a-zA-Z0-9]'','''',''g''))<3 and not (new.admin_uploaded and new.reference_number=''''))');
  execute definition;
  definition:=pg_get_functiondef('public.protect_renovation_financial_history()'::regprocedure);
  definition:=replace(definition,'if tg_table_name=''bank_manual_transactions'' then', $code$if tg_table_name='bank_manual_transactions' then
    if tg_op='UPDATE' and coalesce(old.reference_number,'')='' and length(btrim(new.reference_number)) between 3 and 120
      and (to_jsonb(new)-'reference_number')=(to_jsonb(old)-'reference_number')
      and exists(select 1 from public.renovation_payment_submissions where bank_transaction_id=old.id
        and admin_uploaded and status='verified' and reference_number=new.reference_number) then return new; end if;$code$);
  execute definition;
end; $migration$;

create function public.record_admin_renovation_payment(p_company uuid,p_actor uuid,p_id uuid,p_invoice uuid,p_bank uuid,
  p_amount numeric,p_date date,p_reference text,p_path text,p_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare existing public.renovation_payment_submissions; transaction_id uuid;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,1802));
  select * into existing from public.renovation_payment_submissions where id=p_id;
  if found then
    if existing.company_id=p_company and existing.invoice_id=p_invoice and existing.bank_account_id=p_bank
      and existing.amount=p_amount and existing.payment_date=p_date and existing.proof_sha256=p_hash
      and existing.reference_number=coalesce(btrim(p_reference),'') and existing.admin_uploaded and existing.status='verified'
      then return existing.bank_transaction_id; end if;
    raise exception 'renovation_payment_changed';
  end if;
  if p_amount is null or p_amount<=0 or p_amount<>round(p_amount,2) or p_date is null
    or p_hash !~ '^[0-9a-f]{64}$' then raise exception 'renovation_invalid_proof'; end if;
  insert into public.renovation_payment_submissions(id,company_id,invoice_id,bank_account_id,amount,payment_date,
    reference_number,proof_path,proof_sha256,submitted_by,admin_uploaded)
  values(p_id,p_company,p_invoice,p_bank,p_amount,p_date,coalesce(btrim(p_reference),''),p_path,p_hash,p_actor,true);
  -- One transaction: failure of recording rolls back the pending row too.
  transaction_id:=public.verify_renovation_payment(p_company,p_actor,p_id,true,'Admin uploaded and accepted receipt; bank reconciliation follows separately');
  return transaction_id;
end; $$;

create function public.save_renovation_payment_reference(p_company uuid,p_actor uuid,p_id uuid,p_reference text)
returns void language plpgsql security invoker set search_path='' as $$
declare p public.renovation_payment_submissions; value text:=btrim(p_reference);
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
  select * into p from public.renovation_payment_submissions where id=p_id and company_id=p_company for update;
  if not found or not p.admin_uploaded or p.status<>'verified' then raise exception 'renovation_not_allowed'; end if;
  if p.reference_number=value then return; end if;
  if p.reference_number<>'' or value is null or length(value) not between 3 and 120
    or length(regexp_replace(value,'[^a-zA-Z0-9]','','g'))<3 then raise exception 'renovation_invalid_reference'; end if;
  perform 1 from public.bank_manual_transactions where id=p.bank_transaction_id for update;
  if exists(select 1 from public.bank_manual_transactions where id<>p.bank_transaction_id and company_id=p_company
    and bank_account_id=p.bank_account_id and transaction_date=p.payment_date and amount=p.amount
    and upper(regexp_replace(coalesce(reference_number,''),'[^a-zA-Z0-9]','','g'))=upper(regexp_replace(value,'[^a-zA-Z0-9]','','g')))
    then raise exception 'renovation_payment_already_recorded'; end if;
  update public.renovation_payment_submissions set reference_number=value where id=p.id;
  update public.bank_manual_transactions set reference_number=value where id=p.bank_transaction_id;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
  values(p_company,'renovation_payment',p.id,'bank_reference_saved',jsonb_build_object('reference_number',p.reference_number),
    jsonb_build_object('reference_number',value),'Missing code filled; payment, invoice, receipt and accounting unchanged',p_actor);
end; $$;

create function public.renovation_reference_matches(p_reference text,p_bank_reference text,p_description text)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare code text:=lower(regexp_replace(coalesce(p_reference,''),'[^a-zA-Z0-9]','','g')); pattern text; significant text;
begin
  if length(code)<4 or code !~ '[0-9]' then return false; end if;
  select '(^|[^a-z0-9])'||string_agg(ch,'[[:space:]/-]*')||'($|[^a-z0-9])' into pattern
    from regexp_split_to_table(code,'') ch;
  if lower(coalesce(p_bank_reference,''))~pattern or lower(coalesce(p_description,''))~pattern then return true; end if;
  significant:=regexp_replace(code,'^0+','');
  return code~'^[0-9]+$' and length(significant)>=5 and exists(
    select 1 from regexp_matches(coalesce(p_bank_reference,'')||' '||coalesce(p_description,''),'[0-9]+','g') run
    where regexp_replace(run[1],'^0+','')=significant);
end; $$;

create function public.match_renovation_payment_by_reference(p_company uuid,p_actor uuid,p_transaction uuid,p_line uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare l public.bank_statement_lines; p public.renovation_payment_submissions; candidates integer; existing uuid;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
  select * into l from public.bank_statement_lines where id=p_line for update;
  select * into p from public.renovation_payment_submissions where bank_transaction_id=p_transaction and company_id=p_company and status='verified';
  if l.id is null or p.id is null or p.bank_account_id<>l.bank_account_id
    or not exists(select 1 from public.bank_statement_imports where id=l.statement_import_id and company_id=p_company and status='in_progress')
    or l.transaction_date<'2026-09-01' or date_trunc('month',l.transaction_date)<>date_trunc('month',p.payment_date)
    or not public.renovation_reference_matches(p.reference_number,l.reference_number,l.description)
    then raise exception 'renovation_reference_match_changed'; end if;
  select id into existing from public.bank_reconciliation_matches where statement_line_id=p_line and source_type='manual_bank_transaction' and source_id=p_transaction;
  if existing is not null then return existing; end if;
  select count(*) into candidates from public.renovation_payment_submissions s where s.company_id=p_company and s.status='verified'
    and s.bank_account_id=l.bank_account_id and date_trunc('month',s.payment_date)=date_trunc('month',l.transaction_date)
    and public.renovation_reference_matches(s.reference_number,l.reference_number,l.description)
    and s.amount>coalesce((select sum(matched_amount) from public.bank_reconciliation_matches where source_type='manual_bank_transaction' and source_id=s.bank_transaction_id),0);
  if candidates<>1 then raise exception 'renovation_reference_ambiguous'; end if;
  return public.match_renovation_payment(p_company,p_actor,p_transaction,p_line);
end; $$;
revoke all on function public.record_admin_renovation_payment(uuid,uuid,uuid,uuid,uuid,numeric,date,text,text,text),
  public.save_renovation_payment_reference(uuid,uuid,uuid,text), public.renovation_reference_matches(text,text,text),
  public.match_renovation_payment_by_reference(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.record_admin_renovation_payment(uuid,uuid,uuid,uuid,uuid,numeric,date,text,text,text),
  public.save_renovation_payment_reference(uuid,uuid,uuid,text), public.renovation_reference_matches(text,text,text),
  public.match_renovation_payment_by_reference(uuid,uuid,uuid,uuid) to service_role;
