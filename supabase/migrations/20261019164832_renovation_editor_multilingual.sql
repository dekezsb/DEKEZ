-- Approval required before production. Additive renovation-only editor upgrade.
-- Existing document IDs/numbers, receipts, bank matches and journals are retained.
alter table public.renovation_catalogue
  add column item_code text,
  add column category text not null default '',
  add column cost_price numeric(12,2) check(cost_price>=0 and cost_price<10000000),
  add column active boolean not null default true,
  add column translations jsonb not null default '{}'::jsonb check(jsonb_typeof(translations)='object'),
  add column version integer not null default 1;
update public.renovation_catalogue set item_code='ITEM-'||upper(replace(id::text,'-',''));
alter table public.renovation_catalogue alter column item_code set not null;
create unique index renovation_catalogue_code on public.renovation_catalogue(company_id,lower(item_code));
alter table public.renovation_documents
  add column remarks text not null default '',
  add column tax_rate numeric(5,2) not null default 0 check(tax_rate between 0 and 100),
  add column tax_amount numeric(14,2) not null default 0 check(tax_amount>=0),
  add column tax_account_id uuid references public.accounting_accounts(id);
alter table public.renovation_documents drop constraint renovation_documents_status_check;
alter table public.renovation_documents add constraint renovation_documents_status_check check(status in ('draft','issued','approved','superseded','rejected','voided'));

-- Reuse existing audit snapshots instead of introducing a parallel document store.
create function public.renovation_validate_content(p_company uuid,p_data jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.renovation_clients; x jsonb; q numeric; r numeric; subtotal numeric:=0; percentages numeric:=0;
  discount numeric; value numeric; kind text; tax numeric; taxrate numeric; taxaccount uuid; snapshot jsonb;
begin
  select * into c from public.renovation_clients where company_id=p_company and id=(p_data->>'client_id')::uuid;
  if not found or coalesce(p_data->>'kind','') not in ('quotation','invoice')
    or length(btrim(coalesce(p_data->>'project',''))) not between 1 and 500
    or length(coalesce(p_data->>'site_address',''))>2000 or length(coalesce(p_data->>'terms',''))>15000
    or length(coalesce(p_data->>'remarks',''))>5000
    or (p_data->>'document_date')::date is null or (p_data->>'due_date')::date is null
    or (p_data->>'due_date')::date<(p_data->>'document_date')::date then raise exception 'renovation_invalid'; end if;
  if jsonb_typeof(p_data->'items') is distinct from 'array' or jsonb_array_length(p_data->'items') not between 1 and 100
    or jsonb_typeof(p_data->'stages') is distinct from 'array' or jsonb_array_length(p_data->'stages') not between 1 and 10
    then raise exception 'renovation_invalid_lines'; end if;
  for x in select * from jsonb_array_elements(p_data->'items') loop
    q:=(x->>'quantity')::numeric; r:=(x->>'rate')::numeric;
    if q is null or r is null or not(q>0 and q<=1000000 and q=round(q,3)) or not(r>=0 and r<10000000 and r=round(r,2))
      or length(btrim(coalesce(x->>'description',''))) not between 1 and 1000 or length(btrim(coalesce(x->>'unit',''))) not between 1 and 30
      or length(coalesce(x->>'item_code',''))>80 or length(coalesce(x->>'translation_source',''))>1000
      or (x ? 'translations' and (jsonb_typeof(x->'translations')<>'object' or length((x->'translations')::text)>10000))
      then raise exception 'renovation_invalid_lines'; end if;
    subtotal:=subtotal+round(q*r,2);
  end loop;
  for x in select * from jsonb_array_elements(p_data->'stages') loop
    q:=(x->>'percent')::numeric;
    if q is null or not(q>0 and q<=100 and q=round(q,2)) or length(btrim(coalesce(x->>'label',''))) not between 1 and 200
      then raise exception 'renovation_invalid_stages'; end if;
    percentages:=percentages+q;
  end loop;
  if percentages<>100 then raise exception 'renovation_invalid_stages'; end if;
  kind:=coalesce(p_data->>'discount_kind','amount'); value:=coalesce((p_data->>'discount_value')::numeric,0);
  if kind not in ('amount','percent') or not(value>=0 and value=round(value,2)) or (kind='percent' and value>100) then raise exception 'renovation_invalid_total'; end if;
  discount:=case when kind='percent' then round(subtotal*value/100,2) else value end;
  taxrate:=coalesce((p_data->>'tax_rate')::numeric,0); taxaccount:=nullif(p_data->>'tax_account_id','')::uuid;
  if not(taxrate between 0 and 100 and taxrate=round(taxrate,2)) then raise exception 'renovation_invalid_total'; end if;
  tax:=round((subtotal-discount)*taxrate/100,2);
  if not(subtotal-discount>0 and subtotal-discount+tax<100000000) then raise exception 'renovation_invalid_total'; end if;
  if taxrate>0 and not exists(select 1 from public.accounting_accounts where company_id=p_company and id=taxaccount and is_active and account_type='liability') then raise exception 'renovation_tax_account_required'; end if;
  snapshot:=coalesce(p_data->'client_snapshot',jsonb_build_object('name',c.name,'phone',c.phone,'email',c.email,'address',c.address));
  if jsonb_typeof(snapshot)<>'object' or length(btrim(coalesce(snapshot->>'name',''))) not between 1 and 200
    or length(coalesce(snapshot->>'phone',''))>50 or length(coalesce(snapshot->>'email',''))>254 or length(coalesce(snapshot->>'address',''))>2000 then raise exception 'renovation_invalid_client'; end if;
  return p_data||jsonb_build_object('client_snapshot',snapshot,'total',subtotal-discount+tax,'discount_amount',discount,'discount_kind',kind,'discount_value',value,'tax_rate',taxrate,'tax_amount',tax,'tax_account_id',case when taxrate>0 then taxaccount else null end);
end; $$;

alter function public.save_renovation_draft(uuid,uuid,uuid,integer,jsonb) rename to save_renovation_draft_base;
revoke all on function public.save_renovation_draft_base(uuid,uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
-- Invoker wrapper needs base permission; base retains its own validation/actor checks.
grant execute on function public.save_renovation_draft_base(uuid,uuid,uuid,integer,jsonb) to service_role;
create function public.save_renovation_draft(p_company uuid,p_actor uuid,p_id uuid,p_version integer,p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare v jsonb; oldrow jsonb; newrow jsonb;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select to_jsonb(d) into oldrow from public.renovation_documents d where id=p_id and company_id=p_company for update;
  -- Preserve snapshots on saves from old clients; never silently refresh historic customer details.
  if not(p_data ? 'client_snapshot') and oldrow->>'client_id'=p_data->>'client_id' then p_data:=p_data||jsonb_build_object('client_snapshot',oldrow->'client_snapshot'); end if;
  v:=public.renovation_validate_content(p_company,p_data);
  perform public.save_renovation_draft_base(p_company,p_actor,p_id,p_version,v);
  update public.renovation_documents set client_snapshot=v->'client_snapshot',remarks=coalesce(v->>'remarks',''),tax_rate=(v->>'tax_rate')::numeric,
    tax_amount=(v->>'tax_amount')::numeric,tax_account_id=(v->>'tax_account_id')::uuid,total=(v->>'total')::numeric where id=p_id and company_id=p_company;
  select to_jsonb(d) into newrow from public.renovation_documents d where id=p_id;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
  values(p_company,'renovation_document',p_id,'document_version',oldrow,newrow,'Draft saved',p_actor);
  return p_id;
end; $$;

-- Retain the proven issuing/conversion logic, extending only its tax split and snapshots.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.issue_renovation_document(uuid,uuid,uuid,integer,text,text,date,date)'::regprocedure);
  if strpos(definition,'''credit'',d.total,''description'',d.project)')=0 then raise exception 'Unexpected renovation issue function'; end if;
  definition:=replace(definition,'''credit'',d.total,''description'',d.project)', '''credit'',d.total-d.tax_amount,''description'',d.project)');
  definition:=replace(definition,E'      ),p_actor);', E'      ) || case when d.tax_amount>0 then jsonb_build_array(jsonb_build_object(''account_id'',d.tax_account_id,''debit'',0,''credit'',d.tax_amount,''description'',''Renovation tax'')) else ''[]''::jsonb end,p_actor);');
  definition:=replace(definition,'discount_kind,discount_value,discount_amount)', 'discount_kind,discount_value,discount_amount,remarks,tax_rate,tax_amount,tax_account_id)');
  definition:=replace(definition,'d.discount_kind,d.discount_value,d.discount_amount);', 'd.discount_kind,d.discount_value,d.discount_amount,d.remarks,d.tax_rate,d.tax_amount,d.tax_account_id);');
  execute definition;
end; $migration$;
alter function public.issue_renovation_document(uuid,uuid,uuid,integer,text,text,date,date) rename to issue_renovation_document_base;
create function public.issue_renovation_document(p_company uuid,p_actor uuid,p_id uuid,p_version integer,
 p_approval_name text default null,p_approval_evidence text default null,p_invoice_date date default null,p_due_date date default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid; before_row jsonb; after_row jsonb; checked jsonb;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  select to_jsonb(d) into before_row from public.renovation_documents d where id=p_id and company_id=p_company for update;
  if before_row is null then raise exception 'renovation_missing'; end if;
  checked:=public.renovation_validate_content(p_company,before_row);
  if (checked->>'total')::numeric is distinct from (before_row->>'total')::numeric
    or (checked->>'discount_amount')::numeric is distinct from (before_row->>'discount_amount')::numeric
    or (checked->>'tax_amount')::numeric is distinct from (before_row->>'tax_amount')::numeric
    then raise exception 'renovation_invalid_total'; end if;
  result:=public.issue_renovation_document_base(p_company,p_actor,p_id,p_version,p_approval_name,p_approval_evidence,p_invoice_date,p_due_date);
  select to_jsonb(d) into after_row from public.renovation_documents d where id=result;
  if result<>p_id or before_row is distinct from after_row then
    insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
    values(p_company,'renovation_document',result,'document_version',case when result=p_id then before_row else null end,after_row,'Issued / accepted document',p_actor);
  end if;
  return result;
end; $$;

create function public.save_renovation_catalogue(p_company uuid,p_actor uuid,p_id uuid,p_version integer,p_data jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare oldrow public.renovation_catalogue; newrow public.renovation_catalogue; rate numeric; cost numeric;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into oldrow from public.renovation_catalogue where id=p_id for update;
  if (oldrow.id is not null and (oldrow.company_id<>p_company or oldrow.version<>p_version)) or (oldrow.id is null and p_version<>0) then raise exception 'renovation_changed_or_issued'; end if;
  rate:=(p_data->>'rate')::numeric;cost:=nullif(p_data->>'cost_price','')::numeric;
  if length(btrim(coalesce(p_data->>'item_code',''))) not between 1 and 80 or length(coalesce(p_data->>'category',''))>100
    or rate is null or rate<>round(rate,2) or (cost is not null and cost<>round(cost,2))
    or jsonb_typeof(coalesce(p_data->'translations','{}'))<>'object' or length(coalesce(p_data->'translations','{}')::text)>10000 then raise exception 'renovation_invalid'; end if;
  insert into public.renovation_catalogue(id,company_id,item_code,description,unit,rate,category,cost_price,active,translations)
  values(p_id,p_company,btrim(p_data->>'item_code'),btrim(p_data->>'description'),btrim(p_data->>'unit'),rate,coalesce(p_data->>'category',''),cost,coalesce((p_data->>'active')::boolean,true),coalesce(p_data->'translations','{}'))
  on conflict(id) do update set item_code=excluded.item_code,description=excluded.description,unit=excluded.unit,rate=excluded.rate,category=excluded.category,cost_price=excluded.cost_price,active=excluded.active,translations=excluded.translations,version=renovation_catalogue.version+1 returning * into newrow;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
  values(p_company,'renovation_catalogue',p_id,'library_saved',case when oldrow.id is null then null else to_jsonb(oldrow) end,to_jsonb(newrow),'Explicit master item change; document snapshots unchanged',p_actor);
  return p_id;
end; $$;

-- Official invoice corrections retain the same identity and all payment links.
-- The original snapshot and original journal are NEVER overwritten/deleted.
create function public.correct_renovation_invoice(p_company uuid,p_actor uuid,p_id uuid,p_version integer,p_data jsonb,p_reason text,p_posting_date date) returns uuid
language plpgsql security invoker set search_path='' as $$
declare d public.renovation_documents; v jsonb; newrow jsonb; paid numeric; ar uuid; income uuid; lines jsonb:='[]'; delta numeric; journal uuid;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  select * into d from public.renovation_documents where id=p_id and company_id=p_company for update;
  if not found or d.kind<>'invoice' or d.status<>'issued' or d.version<>p_version then raise exception 'renovation_changed_or_issued'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 2000 or p_posting_date is null then raise exception 'renovation_correction_reason'; end if;
  v:=public.renovation_validate_content(p_company,p_data);
  if v->>'kind'<>'invoice' then raise exception 'renovation_invalid'; end if;
  select coalesce(sum(amount),0) into paid from public.renovation_payment_submissions where invoice_id=d.id and status='verified';
  if (v->>'total')::numeric<paid then raise exception 'renovation_below_received'; end if;
  if (v->>'client_id')::uuid<>d.client_id and exists(select 1 from public.renovation_payment_submissions where invoice_id=d.id and status<>'rejected') then raise exception 'renovation_customer_has_payments'; end if;
  -- Do not move already-posted revenue between periods by editing its display date.
  if (v->>'document_date')::date<>d.document_date then raise exception 'renovation_issued_date_fixed'; end if;
  select id into ar from public.accounting_accounts where company_id=p_company and system_key='renovation_receivable' and is_active;
  select id into income from public.accounting_accounts where company_id=p_company and code='4050' and account_type='income' and is_active;
  delta:=(v->>'total')::numeric-d.total;
  if delta<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account_id',ar,'debit',greatest(delta,0),'credit',greatest(-delta,0))); end if;
  delta:=((v->>'total')::numeric-(v->>'tax_amount')::numeric)-(d.total-d.tax_amount);
  if delta<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account_id',income,'debit',greatest(-delta,0),'credit',greatest(delta,0))); end if;
  if d.tax_account_id is not distinct from (v->>'tax_account_id')::uuid then
    delta:=(v->>'tax_amount')::numeric-d.tax_amount;
    if delta<>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account_id',d.tax_account_id,'debit',greatest(-delta,0),'credit',greatest(delta,0))); end if;
  else
    if d.tax_amount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account_id',d.tax_account_id,'debit',d.tax_amount,'credit',0)); end if;
    if (v->>'tax_amount')::numeric>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account_id',v->>'tax_account_id','debit',0,'credit',(v->>'tax_amount')::numeric)); end if;
  end if;
  if jsonb_array_length(lines)>0 then
    journal:=public.post_manual_journal_entry(p_company,p_posting_date,d.document_number||' / correction v'||(d.version+1),'Renovation invoice correction: '||p_reason,lines,p_actor);
    update public.accounting_journal_entries set source_type='renovation_invoice_adjustment',source_id=d.id where id=journal;
  end if;
  update public.renovation_documents set client_id=(v->>'client_id')::uuid,client_snapshot=v->'client_snapshot',project=v->>'project',site_address=coalesce(v->>'site_address',''),due_date=(v->>'due_date')::date,
    items=v->'items',stages=v->'stages',terms=coalesce(v->>'terms',''),remarks=coalesce(v->>'remarks',''),discount_kind=v->>'discount_kind',discount_value=(v->>'discount_value')::numeric,discount_amount=(v->>'discount_amount')::numeric,
    tax_rate=(v->>'tax_rate')::numeric,tax_amount=(v->>'tax_amount')::numeric,tax_account_id=(v->>'tax_account_id')::uuid,total=(v->>'total')::numeric,version=version+1,updated_at=now() where id=d.id;
  select to_jsonb(x) into newrow from public.renovation_documents x where id=d.id;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
  values(p_company,'renovation_document',d.id,'document_version',to_jsonb(d),newrow||jsonb_build_object('adjustment_journal_id',journal),p_reason,p_actor);
  return d.id;
end; $$;

create function public.close_renovation_document(p_company uuid,p_actor uuid,p_id uuid,p_version integer,p_reason text,p_date date) returns uuid
language plpgsql security invoker set search_path='' as $$
declare d public.renovation_documents; newrow jsonb; journal uuid; lines jsonb; ar uuid; income uuid;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  select * into d from public.renovation_documents where id=p_id and company_id=p_company for update;
  if not found then raise exception 'renovation_missing'; end if;
  if d.status in ('voided','rejected') then return d.id; end if;
  if d.status<>'issued' or d.version<>p_version then raise exception 'renovation_changed_or_issued'; end if;
  if length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'renovation_correction_reason'; end if;
  if d.kind='invoice' then
    if exists(select 1 from public.renovation_payment_submissions where invoice_id=d.id and status<>'rejected') then raise exception 'renovation_customer_has_payments'; end if;
    select id into ar from public.accounting_accounts where company_id=p_company and system_key='renovation_receivable' and is_active;
    select id into income from public.accounting_accounts where company_id=p_company and code='4050' and account_type='income' and is_active;
    lines:=jsonb_build_array(jsonb_build_object('account_id',ar,'credit',d.total,'debit',0),jsonb_build_object('account_id',income,'debit',d.total-d.tax_amount,'credit',0));
    if d.tax_amount>0 then lines:=lines||jsonb_build_array(jsonb_build_object('account_id',d.tax_account_id,'debit',d.tax_amount,'credit',0)); end if;
    journal:=public.post_manual_journal_entry(p_company,p_date,d.document_number||' / void','Void renovation invoice: '||p_reason,lines,p_actor);
    update public.accounting_journal_entries set source_type='renovation_invoice_adjustment',source_id=d.id where id=journal;
  end if;
  update public.renovation_documents set status=case when kind='quotation' then 'rejected' else 'voided' end,version=version+1,updated_at=now() where id=d.id;
  select to_jsonb(x) into newrow from public.renovation_documents x where id=d.id;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
  values(p_company,'renovation_document',d.id,'document_version',to_jsonb(d),newrow||jsonb_build_object('adjustment_journal_id',journal),p_reason,p_actor);
  return d.id;
end; $$;

-- New adjustment journals receive the same immutable-history protection.
do $migration$
declare definition text;
begin
  definition:=pg_get_functiondef('public.protect_renovation_financial_history()'::regprocedure);
  definition:=replace(definition, E'source_type=''renovation_invoice''', E'source_type in (''renovation_invoice'',''renovation_invoice_adjustment'')');
  execute definition;
end; $migration$;
revoke all on function public.renovation_validate_content(uuid,jsonb),public.save_renovation_draft(uuid,uuid,uuid,integer,jsonb),public.issue_renovation_document(uuid,uuid,uuid,integer,text,text,date,date),public.save_renovation_catalogue(uuid,uuid,uuid,integer,jsonb),public.correct_renovation_invoice(uuid,uuid,uuid,integer,jsonb,text,date),public.close_renovation_document(uuid,uuid,uuid,integer,text,date) from public,anon,authenticated;
grant execute on function public.renovation_validate_content(uuid,jsonb),public.save_renovation_draft(uuid,uuid,uuid,integer,jsonb),public.issue_renovation_document(uuid,uuid,uuid,integer,text,text,date,date),public.save_renovation_catalogue(uuid,uuid,uuid,integer,jsonb),public.correct_renovation_invoice(uuid,uuid,uuid,integer,jsonb,text,date),public.close_renovation_document(uuid,uuid,uuid,integer,text,date) to service_role;
