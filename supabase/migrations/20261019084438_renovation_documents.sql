-- Renovation documents are separate from rental bills. All money is posted
-- through the existing company journal; no tenant/payment/receipt is invented.
create table public.renovation_clients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null check (length(btrim(name)) between 1 and 200),
  phone text not null default '', email text not null default '', address text not null default '',
  created_at timestamptz not null default now(), unique(company_id,id)
);
create index renovation_clients_company_name on public.renovation_clients(company_id,name);
create table public.renovation_catalogue (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  description text not null check(length(btrim(description)) between 1 and 1000),
  unit text not null check(length(btrim(unit)) between 1 and 30),
  rate numeric(12,2) not null check(rate >= 0 and rate < 10000000),
  created_at timestamptz not null default now(), unique(company_id,description,unit)
);
create table public.renovation_documents (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  kind text not null check(kind in ('quotation','invoice')),
  status text not null default 'draft' check(status in ('draft','issued','approved','superseded')),
  document_number text,
  client_id uuid not null,
  client_snapshot jsonb not null,
  project text not null check(length(btrim(project)) between 1 and 500),
  site_address text not null default '',
  document_date date not null, due_date date not null,
  items jsonb not null check(jsonb_typeof(items)='array'),
  stages jsonb not null check(jsonb_typeof(stages)='array'),
  terms text not null default '', total numeric(14,2) not null check(total > 0 and total < 100000000),
  discount_kind text not null default 'amount' check(discount_kind in ('amount','percent')),
  discount_value numeric(14,2) not null default 0 check(discount_value>=0),
  discount_amount numeric(14,2) not null default 0 check(discount_amount>=0),
  revision_of_id uuid unique,
  source_quotation_id uuid unique,
  approval_name text, approval_evidence text, approved_at timestamptz,
  journal_entry_id uuid unique references public.accounting_journal_entries(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  version integer not null default 1,
  unique(company_id,id), unique(company_id,document_number),
  foreign key(company_id,client_id) references public.renovation_clients(company_id,id),
  foreign key(company_id,source_quotation_id) references public.renovation_documents(company_id,id),
  foreign key(company_id,revision_of_id) references public.renovation_documents(company_id,id),
  check(due_date >= document_date),
  check(source_quotation_id is null or kind='invoice'),
  check(status <> 'approved' or kind='quotation'),
  check(status='draft' or document_number is not null),
  check(kind <> 'invoice' or status='draft' or journal_entry_id is not null)
);
create index renovation_documents_company_date on public.renovation_documents(company_id,created_at desc);
create sequence public.renovation_quote_number_seq;
create sequence public.renovation_invoice_number_seq;
create unique index renovation_invoice_single_post on public.accounting_journal_entries(company_id,source_id)
  where source_type='renovation_invoice';

-- Server-only access. App pages/actions require reports permissions and derive
-- company + actor from the session, never from submitted form fields.
alter table public.renovation_clients enable row level security;
alter table public.renovation_catalogue enable row level security;
alter table public.renovation_documents enable row level security;
revoke all on public.renovation_clients, public.renovation_catalogue, public.renovation_documents from public,anon,authenticated;
grant select,insert,update on public.renovation_clients, public.renovation_catalogue, public.renovation_documents to service_role;
grant usage,select on public.renovation_quote_number_seq, public.renovation_invoice_number_seq to service_role;

create function public.assert_renovation_actor(p_company uuid,p_actor uuid) returns void
language plpgsql security invoker set search_path='' as $$
begin
  if p_actor is null or p_company is null or not (
    exists(select 1 from public.profiles where id=p_actor and role::text in ('super_admin','admin'))
    or exists(select 1 from public.company_users where company_id=p_company
      and coalesce(user_id,profile_id)=p_actor and status::text='active' and role::text in ('owner','admin','admin_team'))
  ) then raise exception 'renovation_not_allowed'; end if;
end; $$;

create function public.save_renovation_draft(p_company uuid,p_actor uuid,p_id uuid,p_version integer,p_data jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare d public.renovation_documents; c public.renovation_clients; parent public.renovation_documents;
  v_items jsonb; v_stages jsonb; v_total numeric; line jsonb; q numeric; r numeric; v_sum numeric := 0;
  v_discount numeric; v_discount_value numeric; v_discount_kind text; v_revision uuid;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  if p_id is null then raise exception 'renovation_invalid'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_id::text,0));
  select * into d from public.renovation_documents where id=p_id for update;
  if found and (d.company_id<>p_company or d.status<>'draft' or d.version<>p_version) then
    raise exception 'renovation_changed_or_issued';
  end if;
  if d.id is null and p_version<>0 then raise exception 'renovation_changed_or_issued'; end if;
  v_revision := case when d.id is not null then d.revision_of_id else nullif(p_data->>'revision_of_id','')::uuid end;
  if v_revision is not null then
    select * into parent from public.renovation_documents where id=v_revision and company_id=p_company for update;
    if not found or parent.kind<>'quotation' or parent.status<>'issued' or p_data->>'kind'<>'quotation' then
      raise exception 'renovation_changed_or_issued';
    end if;
  end if;
  select * into c from public.renovation_clients where id=(p_data->>'client_id')::uuid and company_id=p_company;
  if not found or coalesce(p_data->>'kind','') not in ('quotation','invoice')
    or length(btrim(coalesce(p_data->>'project',''))) not between 1 and 500
    or length(coalesce(p_data->>'terms',''))>15000 or length(coalesce(p_data->>'site_address',''))>2000
  then raise exception 'renovation_invalid'; end if;
  v_items := p_data->'items'; v_stages := p_data->'stages';
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) not between 1 and 100
    or jsonb_typeof(v_stages) is distinct from 'array' or jsonb_array_length(v_stages) not between 1 and 10
  then raise exception 'renovation_invalid_lines'; end if;
  v_total := 0;
  for line in select * from jsonb_array_elements(v_items) loop
    q := (line->>'quantity')::numeric; r := (line->>'rate')::numeric;
    if q is null or r is null or not(q>0 and q<=1000000 and q=round(q,3))
      or not(r>=0 and r<10000000 and r=round(r,2))
      or length(btrim(coalesce(line->>'description',''))) not between 1 and 1000
      or length(btrim(coalesce(line->>'unit',''))) not between 1 and 30
    then raise exception 'renovation_invalid_lines'; end if;
    v_total := v_total + round(q*r,2);
  end loop;
  v_discount_kind := coalesce(p_data->>'discount_kind','amount');
  v_discount_value := coalesce((p_data->>'discount_value')::numeric,0);
  if v_discount_kind not in ('amount','percent') or not(v_discount_value>=0 and v_discount_value=round(v_discount_value,2))
    or (v_discount_kind='percent' and v_discount_value>100) then raise exception 'renovation_invalid_total'; end if;
  v_discount := case when v_discount_kind='percent' then round(v_total*v_discount_value/100,2) else v_discount_value end;
  v_total := v_total - v_discount;
  if not(v_total>0 and v_total<100000000) then raise exception 'renovation_invalid_total'; end if;
  for line in select * from jsonb_array_elements(v_stages) loop
    q := (line->>'percent')::numeric;
    if q is null or not(q>0 and q<=100 and q=round(q,2))
      or length(btrim(coalesce(line->>'label',''))) not between 1 and 200
    then raise exception 'renovation_invalid_stages'; end if;
    v_sum := v_sum + q;
  end loop;
  if v_sum<>100 then raise exception 'renovation_invalid_stages'; end if;
  insert into public.renovation_documents(id,company_id,kind,client_id,client_snapshot,project,site_address,document_date,due_date,items,stages,terms,total,created_by,discount_kind,discount_value,discount_amount,revision_of_id)
  values(p_id,p_company,p_data->>'kind',c.id,jsonb_build_object('name',c.name,'phone',c.phone,'email',c.email,'address',c.address),
    btrim(p_data->>'project'),coalesce(p_data->>'site_address',''),(p_data->>'document_date')::date,(p_data->>'due_date')::date,
    v_items,v_stages,coalesce(p_data->>'terms',''),v_total,p_actor,v_discount_kind,v_discount_value,v_discount,v_revision)
  on conflict(id) do update set kind=excluded.kind, client_id=excluded.client_id,client_snapshot=excluded.client_snapshot,
    project=excluded.project,site_address=excluded.site_address,document_date=excluded.document_date,due_date=excluded.due_date,
    items=excluded.items,stages=excluded.stages,terms=excluded.terms,total=excluded.total,
    discount_kind=excluded.discount_kind,discount_value=excluded.discount_value,discount_amount=excluded.discount_amount,
    version=renovation_documents.version+1,updated_at=now();
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
  values(p_company,'renovation_document',p_id,'save_draft',case when d.id is null then null else to_jsonb(d) end,
    jsonb_build_object('total',v_total,'items',v_items),'Saved renovation draft',p_actor);
  return p_id;
end; $$;

create function public.issue_renovation_document(p_company uuid,p_actor uuid,p_id uuid,p_version integer,
  p_approval_name text default null,p_approval_evidence text default null,p_invoice_date date default null,p_due_date date default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare d public.renovation_documents; v_id uuid; v_number text; v_journal uuid;
  v_income uuid; v_ar uuid; v_date date; v_due date; v_approve boolean;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  select * into d from public.renovation_documents where id=p_id and company_id=p_company for update;
  if not found then raise exception 'renovation_missing'; end if;
  v_approve := nullif(btrim(p_approval_name),'') is not null;
  -- Completed retries return the same document before checking stale version.
  if d.kind='quotation' and d.status='approved' and v_approve then
    select id into v_id from public.renovation_documents where source_quotation_id=d.id and company_id=p_company;
    return v_id;
  end if;
  if d.status='issued' and not v_approve then return d.id; end if;
  if d.version<>p_version then raise exception 'renovation_changed_or_issued'; end if;
  if v_approve then
    if d.kind<>'quotation' or d.status<>'issued' or length(btrim(coalesce(p_approval_evidence,''))) not between 10 and 2000
      or length(btrim(p_approval_name))>200 or p_invoice_date is null or p_due_date is null
    then raise exception 'renovation_approval_required'; end if;
    v_id := gen_random_uuid(); v_date := p_invoice_date; v_due := p_due_date;
  else
    if d.status<>'draft' then raise exception 'renovation_changed_or_issued'; end if;
    v_id := d.id; v_date := d.document_date; v_due := d.due_date;
  end if;
  if d.kind='quotation' and not v_approve then
    if d.revision_of_id is not null then
      perform 1 from public.renovation_documents where id=d.revision_of_id and company_id=p_company and status='issued' for update;
      if not found then raise exception 'renovation_changed_or_issued'; end if;
      update public.renovation_documents set status='superseded',version=version+1,updated_at=now() where id=d.revision_of_id;
    end if;
    v_number := 'DQ-' || to_char(v_date,'YYYY') || '-' || lpad(nextval('public.renovation_quote_number_seq')::text,6,'0');
    update public.renovation_documents set status='issued',document_number=v_number,version=version+1,updated_at=now() where id=d.id;
  else
    -- Reuse the production renovation account. Never silently repurpose a code.
    select id into v_income from public.accounting_accounts where company_id=p_company and code='4050'
      and account_type='income' and name='Renovation Service Income' and is_active;
    if v_income is null then raise exception 'renovation_income_account_required'; end if;
    -- Dedicated general-company receivable; rental/deposit AR is untouched.
    perform pg_advisory_xact_lock(hashtextextended(p_company::text||':renovation_ar',0));
    select id into v_ar from public.accounting_accounts where company_id=p_company and system_key='renovation_receivable' and account_type='asset' and is_active;
    if v_ar is null then
      insert into public.accounting_accounts(company_id,code,name,account_type,report_group,normal_balance,system_key,is_system,sort_order)
      values(p_company,'1185','Renovation Client Receivables','asset','current_asset','debit','renovation_receivable',true,1185)
      returning id into v_ar;
    end if;
    v_number := 'DRI-' || to_char(v_date,'YYYY') || '-' || lpad(nextval('public.renovation_invoice_number_seq')::text,6,'0');
    v_journal := public.post_manual_journal_entry(p_company,v_date,v_number,
      'Renovation invoice: '||(d.client_snapshot->>'name'),
      jsonb_build_array(
        jsonb_build_object('account_id',v_ar,'debit',d.total,'credit',0,'description',d.project),
        jsonb_build_object('account_id',v_income,'debit',0,'credit',d.total,'description',d.project)
      ),p_actor);
    update public.accounting_journal_entries set source_type='renovation_invoice',source_id=v_id where id=v_journal;
    if v_approve then
      insert into public.renovation_documents(id,company_id,kind,status,document_number,client_id,client_snapshot,project,site_address,
        document_date,due_date,items,stages,terms,total,source_quotation_id,approval_name,approval_evidence,approved_at,journal_entry_id,created_by,discount_kind,discount_value,discount_amount)
      values(v_id,p_company,'invoice','issued',v_number,d.client_id,d.client_snapshot,d.project,d.site_address,v_date,v_due,
        d.items,d.stages,d.terms,d.total,d.id,btrim(p_approval_name),btrim(p_approval_evidence),now(),v_journal,p_actor,d.discount_kind,d.discount_value,d.discount_amount);
      update public.renovation_documents set status='approved',approval_name=btrim(p_approval_name),approval_evidence=btrim(p_approval_evidence),
        approved_at=now(),version=version+1,updated_at=now() where id=d.id;
    else
      update public.renovation_documents set status='issued',document_number=v_number,journal_entry_id=v_journal,
        version=version+1,updated_at=now() where id=d.id;
    end if;
  end if;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
  values(p_company,'renovation_document',v_id,case when v_approve then 'approval_and_invoice' else 'issue' end,to_jsonb(d),
    jsonb_build_object('document_number',v_number,'journal_entry_id',v_journal,'approval_name',p_approval_name,'approval_evidence',p_approval_evidence),
    case when v_approve then 'Client approval recorded by staff; original quotation retained' else 'Document issued by staff' end,p_actor);
  return v_id;
end; $$;
revoke all on function public.assert_renovation_actor(uuid,uuid), public.save_renovation_draft(uuid,uuid,uuid,integer,jsonb),
  public.issue_renovation_document(uuid,uuid,uuid,integer,text,text,date,date) from public,anon,authenticated;
grant execute on function public.assert_renovation_actor(uuid,uuid), public.save_renovation_draft(uuid,uuid,uuid,integer,jsonb),
  public.issue_renovation_document(uuid,uuid,uuid,integer,text,text,date,date) to service_role;

-- Private renovation proofs, never tenant payment submissions.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('renovation-proofs','renovation-proofs',false,5242880,array['image/jpeg','image/png','application/pdf'])
on conflict(id) do nothing;
create table public.renovation_payment_submissions (
  id uuid primary key,
  company_id uuid not null references public.companies(id),
  invoice_id uuid not null,
  bank_account_id uuid not null references public.bank_accounts(id),
  amount numeric(14,2) not null check(amount>0), payment_date date not null,
  reference_number text not null check(length(btrim(reference_number)) between 3 and 120),
  proof_path text not null, proof_sha256 text not null check(length(proof_sha256)=64),
  status text not null default 'pending' check(status in ('pending','verified','rejected')),
  bank_transaction_id uuid unique references public.bank_manual_transactions(id),
  submitted_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
  verified_by uuid references auth.users(id), verified_at timestamptz, rejection_reason text,
  foreign key(company_id,invoice_id) references public.renovation_documents(company_id,id),
  check((status='verified')=(bank_transaction_id is not null))
);
create index renovation_payment_invoice on public.renovation_payment_submissions(company_id,invoice_id);
create unique index renovation_payment_proof_once on public.renovation_payment_submissions(company_id,proof_sha256) where status<>'rejected';
create unique index renovation_payment_reference_once on public.renovation_payment_submissions(company_id,bank_account_id,payment_date,amount,upper(regexp_replace(reference_number,'[^a-zA-Z0-9]','','g'))) where status<>'rejected';
alter table public.renovation_payment_submissions enable row level security;
revoke all on public.renovation_payment_submissions from public,anon,authenticated;
grant select,insert,update on public.renovation_payment_submissions to service_role;

create function public.verify_renovation_payment(p_company uuid,p_actor uuid,p_id uuid,p_accept boolean,p_reason text default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.renovation_payment_submissions; d public.renovation_documents; v_paid numeric; v_ar uuid; v_transaction uuid; v_invoice uuid;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  select invoice_id into v_invoice from public.renovation_payment_submissions where id=p_id and company_id=p_company;
  select * into d from public.renovation_documents where id=v_invoice and company_id=p_company for update;
  if not found or d.kind<>'invoice' or d.status<>'issued' then raise exception 'renovation_invoice_required'; end if;
  select * into p from public.renovation_payment_submissions where id=p_id and company_id=p_company for update;
  if p.status='verified' and p_accept then return p.bank_transaction_id; end if;
  if p.status='rejected' and not p_accept then return null; end if;
  if p.status<>'pending' or p_accept is null then raise exception 'renovation_payment_changed'; end if;
  if not p_accept then
    if length(btrim(coalesce(p_reason,''))) not between 3 and 2000 then raise exception 'renovation_rejection_reason'; end if;
    update public.renovation_payment_submissions set status='rejected',rejection_reason=btrim(p_reason),verified_by=p_actor,verified_at=now() where id=p_id;
  else
    select coalesce(sum(amount),0) into v_paid from public.renovation_payment_submissions where invoice_id=d.id and status='verified';
    if p.amount>d.total-v_paid then raise exception 'renovation_overpayment'; end if;
    if exists(select 1 from public.accounting_periods where company_id=p_company and status='locked' and p.payment_date between period_start and period_end)
      then raise exception 'journal_period_locked'; end if;
    perform 1 from public.bank_accounts where id=p.bank_account_id and company_id=p_company for update;
    if not found then raise exception 'renovation_wrong_bank'; end if;
    if exists(select 1 from public.bank_manual_transactions where company_id=p_company and bank_account_id=p.bank_account_id
      and amount=p.amount and transaction_date=p.payment_date and upper(regexp_replace(coalesce(reference_number,''),'[^a-zA-Z0-9]','','g'))=upper(regexp_replace(p.reference_number,'[^a-zA-Z0-9]','','g')))
      then raise exception 'renovation_payment_already_recorded'; end if;
    select id into v_ar from public.accounting_accounts where company_id=p_company and system_key='renovation_receivable' and is_active;
    if v_ar is null then raise exception 'renovation_receivable_required'; end if;
    -- Existing bank-receipt accounting: debit bank, credit renovation AR.
    -- Do NOT post another income journal; the invoice already posted income.
    insert into public.bank_manual_transactions(company_id,bank_account_id,offset_account_id,transaction_date,amount,description,reference_number,attachment_bucket_name,attachment_file_path,created_by)
    values(p_company,p.bank_account_id,v_ar,p.payment_date,p.amount,'RENOVATION PAYMENT · '||d.document_number||' · '||(d.client_snapshot->>'name'),p.reference_number,'renovation-proofs',p.proof_path,p_actor)
    returning id into v_transaction;
    update public.renovation_payment_submissions set status='verified',bank_transaction_id=v_transaction,verified_by=p_actor,verified_at=now() where id=p.id;
  end if;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,reason,performed_by)
  values(p_company,'renovation_payment',p.id,case when p_accept then 'verified' else 'rejected' end,to_jsonb(p),
    jsonb_build_object('bank_transaction_id',v_transaction,'amount',p.amount),coalesce(p_reason,'Renovation payment proof verified'),p_actor);
  return v_transaction;
end; $$;

create function public.match_renovation_payment(p_company uuid,p_actor uuid,p_transaction uuid,p_line uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p public.bank_manual_transactions; l public.bank_statement_lines; v_match uuid; v_amount numeric; v_bank_remaining numeric; v_payment_remaining numeric;
begin
  perform public.assert_renovation_actor(p_company,p_actor);
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
  select * into l from public.bank_statement_lines where id=p_line for update;
  if not found or l.amount<=0 or l.status='ignored' or l.duplicate_of_line_id is not null then raise exception 'renovation_bank_line_invalid'; end if;
  if not exists(select 1 from public.bank_statement_imports where id=l.statement_import_id and company_id=p_company and status='in_progress') then raise exception 'renovation_wrong_bank'; end if;
  select * into p from public.bank_manual_transactions where id=p_transaction and company_id=p_company for update;
  if not found or p.bank_account_id<>l.bank_account_id or not exists(select 1 from public.renovation_payment_submissions where bank_transaction_id=p.id and status='verified' and company_id=p_company)
    then raise exception 'renovation_verified_payment_required'; end if;
  select id into v_match from public.bank_reconciliation_matches where statement_line_id=l.id and source_type='manual_bank_transaction' and source_id=p.id;
  if v_match is not null then return v_match; end if;
  select l.amount-coalesce(sum(matched_amount),0) into v_bank_remaining from public.bank_reconciliation_matches where statement_line_id=l.id;
  select p.amount-coalesce(sum(matched_amount),0) into v_payment_remaining from public.bank_reconciliation_matches where source_type='manual_bank_transaction' and source_id=p.id;
  v_amount := least(v_bank_remaining,v_payment_remaining);
  if v_amount<=0 then raise exception 'renovation_match_exhausted'; end if;
  insert into public.bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,match_method,created_by)
  values(l.id,'manual_bank_transaction',p.id,v_amount,case when v_amount=v_bank_remaining then 'manual' else 'split' end,p_actor) returning id into v_match;
  update public.bank_statement_lines set status=case when v_amount=v_bank_remaining then 'matched' else 'unmatched' end,updated_at=now() where id=l.id;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,after_data,reason,performed_by)
  values(p_company,'renovation_payment',p.id,'bank_matched',jsonb_build_object('statement_line_id',l.id,'amount',v_amount),'Matched existing verified renovation receipt; no new money or invoice posting',p_actor);
  return v_match;
end; $$;
revoke all on function public.verify_renovation_payment(uuid,uuid,uuid,boolean,text),public.match_renovation_payment(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.verify_renovation_payment(uuid,uuid,uuid,boolean,text),public.match_renovation_payment(uuid,uuid,uuid,uuid) to service_role;

-- Extend the existing rental guard only for verified renovation receipts.
-- The existing function body remains byte-for-byte after this early branch;
-- rental matching, room/month checks and duplicate safeguards stay untouched.
create function public.guard_renovation_allocation(p_new jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare p public.bank_manual_transactions; l public.bank_statement_lines; company uuid; used_bank numeric; used_payment numeric; amount numeric;
begin
  select company_id into company from public.bank_manual_transactions where id=(p_new->>'source_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended(company::text,1801));
  select * into l from public.bank_statement_lines where id=(p_new->>'statement_line_id')::uuid for update;
  select * into p from public.bank_manual_transactions where id=(p_new->>'source_id')::uuid for update;
  amount := (p_new->>'matched_amount')::numeric;
  if l.id is null or p.id is null or amount is null or amount<=0 or l.amount<=0 or l.status='ignored' or l.duplicate_of_line_id is not null
    or p.bank_account_id<>l.bank_account_id or coalesce((p_new->>'existing_payment_link')::boolean,false)
    or not exists(select 1 from public.bank_statement_imports where id=l.statement_import_id and company_id=p.company_id and status='in_progress')
    or not exists(select 1 from public.renovation_payment_submissions where bank_transaction_id=p.id and status='verified' and company_id=p.company_id)
  then raise exception 'renovation_bank_line_invalid'; end if;
  -- One bank line can cover multiple renovation receipts, but never silently
  -- combine an unrelated rental / expense allocation with a renovation one.
  if exists(select 1 from public.bank_reconciliation_matches m where m.statement_line_id=l.id and not (
    m.source_type='manual_bank_transaction' and exists(select 1 from public.renovation_payment_submissions s where s.bank_transaction_id=m.source_id and s.status='verified')
  )) then raise exception 'renovation_bank_line_already_used'; end if;
  select coalesce(sum(matched_amount),0) into used_bank from public.bank_reconciliation_matches where statement_line_id=l.id;
  select coalesce(sum(matched_amount),0) into used_payment from public.bank_reconciliation_matches where source_type='manual_bank_transaction' and source_id=p.id;
  if used_bank+amount>l.amount or used_payment+amount>p.amount then raise exception 'renovation_allocation_exceeds_balance'; end if;
end; $$;
revoke all on function public.guard_renovation_allocation(jsonb) from public,anon,authenticated;
grant execute on function public.guard_renovation_allocation(jsonb) to service_role;
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('public.guard_existing_payment_bank_match()'::regprocedure);
  if strpos(definition,'guard_renovation_allocation')>0 then raise exception 'renovation_guard_already_installed'; end if;
  if strpos(definition,'new.existing_payment_link')=0 then raise exception 'unexpected_existing_reconciliation_guard'; end if;
  definition := regexp_replace(definition,'begin',E'begin\n  if new.source_type=''manual_bank_transaction'' and exists(select 1 from public.renovation_payment_submissions where bank_transaction_id=new.source_id and status=''verified'') then\n    if tg_op=''UPDATE'' then raise exception ''Use audited unmatch before changing a renovation allocation''; end if;\n    perform public.guard_renovation_allocation(to_jsonb(new));\n    return new;\n  end if;',1,1);
  execute definition;
end; $migration$;

-- Keep the general accounting correction screens from desynchronizing a
-- renovation invoice, its verified proof and its receivable balance.
create function public.protect_renovation_financial_history() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_table_name='bank_manual_transactions' then
    if exists(select 1 from public.renovation_payment_submissions where bank_transaction_id=old.id and status='verified') then
      raise exception 'Verified renovation receipts cannot be changed through general accounting corrections';
    end if;
  elsif tg_table_name='accounting_journal_entries' then
    if old.source_type='renovation_invoice' then raise exception 'Issued renovation invoice accounting is immutable'; end if;
  elsif tg_table_name='accounting_journal_lines' then
    if exists(select 1 from public.accounting_journal_entries where id=old.journal_entry_id and source_type='renovation_invoice') then
      raise exception 'Issued renovation invoice accounting is immutable';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end; $$;
revoke all on function public.protect_renovation_financial_history() from public,anon,authenticated;
create trigger protect_renovation_receipt before update or delete on public.bank_manual_transactions
for each row execute function public.protect_renovation_financial_history();
create trigger protect_renovation_journal before update or delete on public.accounting_journal_entries
for each row execute function public.protect_renovation_financial_history();
create trigger protect_renovation_journal_line before update or delete on public.accounting_journal_lines
for each row execute function public.protect_renovation_financial_history();

create function public.guard_renovation_payment_proof() returns trigger
language plpgsql security invoker set search_path='' as $$
declare d public.renovation_documents;
begin
  if tg_op='UPDATE' then
    if old.status<>'pending' or (to_jsonb(new)-array['status','bank_transaction_id','verified_by','verified_at','rejection_reason'])
      is distinct from (to_jsonb(old)-array['status','bank_transaction_id','verified_by','verified_at','rejection_reason']) then
      raise exception 'Renovation proof history is immutable; reject incorrect pending proof and submit a replacement';
    end if;
    return new;
  end if;
  perform public.assert_renovation_actor(new.company_id,new.submitted_by);
  select * into d from public.renovation_documents where id=new.invoice_id and company_id=new.company_id;
  if d.id is null or d.kind<>'invoice' or d.status<>'issued' or new.amount>d.total or new.status<>'pending' then
    raise exception 'renovation_invoice_required';
  end if;
  if not exists(select 1 from public.bank_accounts where id=new.bank_account_id and company_id=new.company_id) then
    raise exception 'renovation_wrong_bank';
  end if;
  if new.proof_path not like new.company_id::text||'/'||new.invoice_id::text||'/%'
    or length(regexp_replace(new.reference_number,'[^a-zA-Z0-9]','','g'))<3 then raise exception 'renovation_invalid_proof'; end if;
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,after_data,reason,performed_by)
  values(new.company_id,'renovation_payment',new.id,'proof_submitted',to_jsonb(new),'Pending verification; no money posted',new.submitted_by);
  return new;
end; $$;
revoke all on function public.guard_renovation_payment_proof() from public,anon,authenticated;
create trigger guard_renovation_payment_proof before insert or update on public.renovation_payment_submissions
for each row execute function public.guard_renovation_payment_proof();
