-- Client presentation only. No invoice, payment, journal or reconciliation writes.
-- Review/apply separately; this migration does not convert existing accounts.
alter type public.app_role add value if not exists 'client_owner';
create schema if not exists owner_private;
revoke all on schema owner_private from public, anon;
grant usage on schema owner_private to authenticated, service_role;

create table public.client_owner_settings (
 owner_id uuid primary key references public.profiles(id),
 tin text, address text, enabled boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.owner_portal_documents (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.client_owner_settings(owner_id),
 property_id uuid references public.properties(id), title text not null check(length(title) between 1 and 200),
 category text not null check(category in ('agreement','owner','property','statement','invoice','receipt','maintenance','other','cover')),
 bucket_name text not null references storage.buckets(id), file_path text not null,
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png')),
 document_date date not null, published_at timestamptz, revoked_at timestamptz,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,bucket_name,file_path)
);
create index owner_documents_scope on public.owner_portal_documents(owner_id,property_id,document_date);
create table public.owner_portal_agreements (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.client_owner_settings(owner_id),
 property_id uuid not null references public.properties(id), document_id uuid not null references public.owner_portal_documents(id),
 start_date date not null, end_date date not null check(end_date>=start_date),
 management_fee text not null, terminated_at date,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index owner_agreements_scope on public.owner_portal_agreements(owner_id,property_id,end_date);
-- These rows publish a client-safe summary, not a duplicate expense/claim.
create table public.owner_portal_shares (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.client_owner_settings(owner_id),
 property_id uuid not null references public.properties(id), expense_id uuid references public.expenses(id),
 claim_id uuid references public.claims(id), title text not null, summary text not null default '',
 reported_date date, completed_date date, chargeable boolean not null default false,
 owner_claim_amount numeric(14,2) not null default 0 check(owner_claim_amount>=0 and owner_claim_amount::text not in ('NaN','Infinity','-Infinity')),
 billing_status text not null default 'Pending claim' check(billing_status in ('Issue reported','In progress','Completed','Pending claim','Included in statement','Paid by owner','Closed')),
 published_at timestamptz, revoked_at timestamptz, created_by uuid not null references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(num_nonnulls(expense_id,claim_id)=1), unique(owner_id,expense_id), unique(owner_id,claim_id)
);
alter table public.owner_portal_documents add column share_id uuid references public.owner_portal_shares(id);
create index owner_shares_scope on public.owner_portal_shares(owner_id,property_id);
-- Issued statement snapshots are presentation records backed by an approved
-- existing document. They never create an owner ledger or payment.
create table public.owner_portal_statements (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.client_owner_settings(owner_id),
 property_id uuid not null references public.properties(id), period date not null check(extract(day from period)=1),
 document_id uuid not null references public.owner_portal_documents(id),
 rental_income numeric(14,2) not null, collected numeric(14,2) not null, outstanding numeric(14,2) not null,
 expenses numeric(14,2) not null, maintenance numeric(14,2) not null, management_fee numeric(14,2) not null,
 net_payout numeric(14,2) generated always as (collected-expenses-maintenance-management_fee) stored,
 source_reference text not null check(length(trim(source_reference))>0),
 approved_by uuid not null references public.profiles(id), approved_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_id,property_id,period),
 check(least(rental_income,collected,outstanding,expenses,maintenance,management_fee)>=0)
);
create table public.owner_portal_payout_links (
 id uuid primary key default gen_random_uuid(), statement_id uuid not null references public.owner_portal_statements(id),
 bank_line_id uuid not null references public.bank_statement_lines(id), amount numeric(14,2) not null check(amount>0),
 proof_document_id uuid references public.owner_portal_documents(id),
 approved_by uuid not null references public.profiles(id), approved_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(statement_id,bank_line_id)
);
create index owner_payout_bank_source on public.owner_portal_payout_links(bank_line_id);

create function owner_private.is_client() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role='client_owner');
$$;
revoke all on function owner_private.is_client() from public,anon;
grant execute on function owner_private.is_client() to authenticated,service_role;

create function owner_private.has_property(p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from public.property_owners o join public.client_owner_settings s on s.owner_id=o.owner_id
 join public.profiles u on u.id=o.owner_id
 where o.owner_id=auth.uid() and o.property_id=p and o.start_date<=current_date
 and (o.end_date is null or o.end_date>=current_date) and s.enabled and u.role='client_owner' and u.registration_status='approved');
$$;
revoke all on function owner_private.has_property(uuid) from public,anon;
grant execute on function owner_private.has_property(uuid) to authenticated,service_role;

-- Existing permissive policies must not give a client raw operational rows.
-- Existing Owner/Admin/tenant/staff predicates and records remain unchanged.
do $$ declare t record; begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind='r' and c.relrowsecurity
 and c.relname not like 'owner_portal_%' and c.relname not in ('client_owner_settings','profiles') loop
 execute format('create policy client_owner_raw_boundary on public.%I as restrictive for all to authenticated using (not (select owner_private.is_client())) with check (not (select owner_private.is_client()))',t.relname);
 end loop;
end $$;
create policy client_owner_profile_read on public.profiles as restrictive for select to authenticated
 using(not (select owner_private.is_client()) or id=(select auth.uid()));
create policy client_owner_profile_insert on public.profiles as restrictive for insert to authenticated with check(not (select owner_private.is_client()));
create policy client_owner_profile_update on public.profiles as restrictive for update to authenticated using(not (select owner_private.is_client())) with check(not (select owner_private.is_client()));
create policy client_owner_profile_delete on public.profiles as restrictive for delete to authenticated using(not (select owner_private.is_client()));
create policy client_owner_storage_boundary on storage.objects as restrictive for all to authenticated
 using(not (select owner_private.is_client())) with check(not (select owner_private.is_client()));

-- Block legacy SECURITY DEFINER endpoints for client accounts too. RLS alone
-- cannot protect RPCs. No existing pre-request hook may be silently replaced.
create function owner_private.check_request() returns void language plpgsql security definer set search_path='' as $$
declare p text:=trim(both '/' from coalesce(current_setting('request.path',true),''));
 m text:=coalesce(current_setting('request.method',true),'');
begin
 if owner_private.is_client() and not (
  (p='profiles' and m in ('GET','HEAD')) or
  (p='rpc/client_owner_snapshot' and m in ('GET','POST'))
 ) then raise insufficient_privilege using message='Client portal access only'; end if;
end $$;
revoke all on function owner_private.check_request() from public,anon;
grant execute on function owner_private.check_request() to authenticated,anon,service_role;
grant usage on schema owner_private to anon;
do $$ begin
 if exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) v
 where v like 'pgrst.db_pre_request=%') then raise exception 'Review existing API pre-request hook before installing client portal'; end if;
end $$;
alter role authenticator set pgrst.db_pre_request='owner_private.check_request';
notify pgrst,'reload config';

do $$ declare t text; begin
 foreach t in array array['client_owner_settings','owner_portal_documents','owner_portal_agreements','owner_portal_shares','owner_portal_statements','owner_portal_payout_links'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 end loop;
end $$;

create function owner_private.snapshot(p_month date,p_property uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); ids uuid[]; result jsonb;
begin
 if actor is null or not exists(select 1 from public.profiles p join public.client_owner_settings s on s.owner_id=p.id
 where p.id=actor and p.role='client_owner' and p.registration_status='approved' and s.enabled)
 then raise insufficient_privilege using message='Owner portal unavailable'; end if;
 if p_month is null or extract(day from p_month)<>1 then raise exception 'Invalid reporting month'; end if;
 select coalesce(array_agg(distinct o.property_id),'{}') into ids from public.property_owners o
 where o.owner_id=actor and owner_private.has_property(o.property_id);
 if p_property is not null and not(p_property=any(ids)) then raise insufficient_privilege using message='Property unavailable'; end if;
 select jsonb_build_object(
 'profile',(select jsonb_build_object('name',coalesce(nullif(p.company_name,''),p.full_name),'identity',p.identity_number,
 'phone',p.phone,'tin',s.tin,'address',s.address,'bank_name',p.bank_name,'bank_holder',p.bank_account_holder,'bank_number',p.bank_account_number)
 from public.profiles p join public.client_owner_settings s on s.owner_id=p.id where p.id=actor),
 'properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'address',p.address,'city',p.city)) from public.properties p where p.id=any(ids)),'[]'),
 'rooms',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'property_id',r.property_id,'name',coalesce(r.name,r.room_number),'status',r.status,'rent',r.monthly_rent)) from public.rooms r
 where r.property_id=any(ids) and (p_property is null or r.property_id=p_property)),'[]'),
 'collections',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'property_id',b.property_id,'room_id',b.room_id,'date',b.due_date,
 'amount',b.amount,'paid',least(b.amount,coalesce(b.paid_amount,0)),'outstanding',greatest(b.amount-coalesce(b.paid_amount,0),0)))
 from public.rent_bills b where b.property_id=any(ids) and (p_property is null or b.property_id=p_property)
 and b.bill_month=p_month and b.removed_at is null and b.status::text not in ('void','voided','cancelled')),'[]'),
 'receipts',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'property_id',p.property_id,'room_id',p.room_id,'bill_id',p.rent_bill_id,'amount',p.amount,'date',p.payment_date))
 from public.payments p where p.property_id=any(ids) and (p_property is null or p.property_id=p_property)
 and p.category='monthly_rent' and p.status::text='confirmed' and p.reversed_at is null and p.payment_date>=p_month and p.payment_date<(p_month+interval '1 month')),'[]'),
 'expenses',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'property_id',s.property_id,'room_id',e.room_id,'title',s.title,'summary',s.summary,'amount',e.amount+coalesce(e.tax_amount,0),'date',e.expense_date,'status',s.billing_status))
 from public.owner_portal_shares s join public.expenses e on e.id=s.expense_id and e.property_id=s.property_id
 where s.owner_id=actor and s.property_id=any(ids) and (p_property is null or s.property_id=p_property) and s.published_at is not null and s.revoked_at is null
 and e.charge_to='owner' and e.status in ('verified','reimbursed') and e.expense_date>=p_month and e.expense_date<(p_month+interval '1 month')),'[]'),
 'claims',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'property_id',s.property_id,'room_id',c.room_id,'title',s.title,'summary',s.summary,'amount',c.total_amount,'claimed',s.owner_claim_amount,'chargeable',s.chargeable,'reported',s.reported_date,'completed',s.completed_date,'status',s.billing_status))
 from public.owner_portal_shares s join public.claims c on c.id=s.claim_id and c.property_id=s.property_id where s.owner_id=actor and s.property_id=any(ids)
 and (p_property is null or s.property_id=p_property) and s.published_at is not null and s.revoked_at is null
 and coalesce(s.completed_date,s.reported_date)>=p_month and coalesce(s.completed_date,s.reported_date)<(p_month+interval '1 month')),'[]'),
 'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'property_id',d.property_id,'share_id',d.share_id,'title',d.title,'category',d.category,'mime',d.mime_type,'date',d.document_date))
 from public.owner_portal_documents d where d.owner_id=actor and (d.property_id is null or d.property_id=any(ids)) and (p_property is null or d.property_id=p_property)
 and d.published_at is not null and d.revoked_at is null),'[]'),
 'agreements',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'property_id',a.property_id,'document_id',a.document_id,'start',a.start_date,'end',a.end_date,'fee',a.management_fee,'terminated',a.terminated_at))
 from public.owner_portal_agreements a join public.owner_portal_documents d on d.id=a.document_id and d.owner_id=a.owner_id and d.property_id=a.property_id
 where a.owner_id=actor and a.property_id=any(ids) and (p_property is null or a.property_id=p_property) and d.published_at is not null and d.revoked_at is null),'[]'),
 'statements',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'property_id',s.property_id,'document_id',s.document_id,'period',s.period,'income',s.rental_income,'collected',s.collected,'outstanding',s.outstanding,'expenses',s.expenses,'maintenance',s.maintenance,'fee',s.management_fee,'net',s.net_payout,
 'paid',coalesce((select sum(l.amount) from public.owner_portal_payout_links l join public.bank_statement_lines b on b.id=l.bank_line_id where l.statement_id=s.id and b.amount<0 and b.status in ('matched','adjusted')),0)))
 from public.owner_portal_statements s join public.owner_portal_documents d on d.id=s.document_id and d.owner_id=s.owner_id and d.property_id=s.property_id
 where s.owner_id=actor and s.property_id=any(ids) and (p_property is null or s.property_id=p_property) and s.period=p_month and d.published_at is not null and d.revoked_at is null),'[]'),
 'payouts',coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'statement_id',s.id,'property_id',s.property_id,'amount',l.amount,'date',b.transaction_date,'reference',b.reference_number,'proof_document_id',l.proof_document_id))
 from public.owner_portal_payout_links l join public.owner_portal_statements s on s.id=l.statement_id join public.bank_statement_lines b on b.id=l.bank_line_id
 join public.owner_portal_documents d on d.id=s.document_id and d.owner_id=s.owner_id
 where s.owner_id=actor and s.property_id=any(ids) and (p_property is null or s.property_id=p_property) and s.period=p_month and b.amount<0 and b.status in ('matched','adjusted') and d.published_at is not null and d.revoked_at is null),'[]')
 ) into result;
 return result;
end $$;
revoke all on function owner_private.snapshot(date,uuid) from public,anon;
grant execute on function owner_private.snapshot(date,uuid) to authenticated;
create function public.client_owner_snapshot(p_month date,p_property uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select owner_private.snapshot(p_month,p_property); $$;
revoke all on function public.client_owner_snapshot(date,uuid) from public,anon;
grant execute on function public.client_owner_snapshot(date,uuid) to authenticated;

create table public.owner_portal_audit (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
 actor_id uuid not null references public.profiles(id), action text not null, record_id uuid,
 details jsonb not null, created_at timestamptz not null default now()
);
alter table public.owner_portal_audit enable row level security;
revoke all on public.owner_portal_audit from anon,authenticated;
grant select,insert on public.owner_portal_audit to service_role;
create function owner_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Issued owner records are immutable; revoke access or issue a new document instead'; end $$;
create trigger owner_audit_immutable before update or delete on public.owner_portal_audit for each row execute function owner_private.immutable();
create trigger owner_statement_immutable before update or delete on public.owner_portal_statements for each row execute function owner_private.immutable();
create trigger owner_payout_immutable before update or delete on public.owner_portal_payout_links for each row execute function owner_private.immutable();

-- Administrative publication is separate from accounting. Only the server can
-- call this, and the actor is checked again here. Existing file bytes are reused.
create function public.manage_client_owner(p_actor uuid,p_owner uuid,p_action text,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare rid uuid; prop uuid:=nullif(p_data->>'property_id','')::uuid;
 doc public.owner_portal_documents; stmt public.owner_portal_statements; bank public.bank_statement_lines;
 amount numeric; other numeric; x uuid;
begin
 if not exists(select 1 from public.profiles where id=p_actor and role='super_admin' and registration_status='approved') then raise insufficient_privilege; end if;
 if not exists(select 1 from public.profiles where id=p_owner and role='client_owner') then raise exception 'Select a Client Owner account'; end if;
 if prop is not null and not exists(select 1 from public.properties where id=prop) then raise exception 'Property not found'; end if;
 if p_action='settings' then
  insert into public.client_owner_settings(owner_id,tin,address,enabled) values(p_owner,p_data->>'tin',p_data->>'address',coalesce((p_data->>'enabled')::boolean,false))
  on conflict(owner_id) do update set tin=excluded.tin,address=excluded.address,enabled=excluded.enabled,updated_at=now();
  rid:=p_owner;
 elsif p_action='assign' then
  if prop is null then raise exception 'Select a property'; end if;
  insert into public.client_owner_settings(owner_id) values(p_owner) on conflict do nothing;
  if exists(select 1 from public.property_owners where owner_id=p_owner and property_id=prop and end_date is null) then return p_owner; end if;
  -- Do not close or rewrite any existing Owner/Admin ownership relationship.
  insert into public.property_owners(property_id,owner_id,ownership_percentage,start_date,created_by)
  values(prop,p_owner,100,current_date,p_actor) returning id into rid;
 elsif p_action='document' then
  if not exists(select 1 from public.client_owner_settings where owner_id=p_owner) then raise exception 'Configure owner settings first'; end if;
  if prop is not null and not exists(select 1 from public.property_owners where owner_id=p_owner and property_id=prop and end_date is null) then raise exception 'Assign property first'; end if;
  if not exists(select 1 from storage.objects o join storage.buckets b on b.id=o.bucket_id where o.bucket_id=p_data->>'bucket' and o.name=p_data->>'path' and not b.public) then raise exception 'Select an existing private file'; end if;
  x:=nullif(p_data->>'share_id','')::uuid;
  if x is not null and not exists(select 1 from public.owner_portal_shares where id=x and owner_id=p_owner and property_id=prop) then raise exception 'Invalid shared record'; end if;
  insert into public.owner_portal_documents(owner_id,property_id,title,category,bucket_name,file_path,mime_type,document_date,published_at,created_by,share_id)
  values(p_owner,prop,p_data->>'title',p_data->>'category',p_data->>'bucket',p_data->>'path',p_data->>'mime',(p_data->>'date')::date,now(),p_actor,x) returning id into rid;
 elsif p_action='revoke_document' then
  update public.owner_portal_documents set revoked_at=now(),updated_at=now() where id=(p_data->>'id')::uuid and owner_id=p_owner returning id into rid;
  if rid is null then raise exception 'Document not found'; end if;
 elsif p_action='share' then
  if not exists(select 1 from public.property_owners where owner_id=p_owner and property_id=prop and end_date is null) then raise exception 'Assign property first'; end if;
  x:=(p_data->>'source_id')::uuid;
  if p_data->>'source_type'='expense' then
   if not exists(select 1 from public.expenses where id=x and property_id=prop and charge_to='owner' and status in ('verified','reimbursed')) then raise exception 'Only verified owner-charged expenses may be shared'; end if;
  elsif p_data->>'source_type'='claim' then
   if not exists(select 1 from public.claims where id=x and property_id=prop) then raise exception 'Claim does not belong to this property'; end if;
  else raise exception 'Invalid source type'; end if;
  amount:=0;
  if p_data->>'source_type'='claim' and coalesce((p_data->>'chargeable')::boolean,false) then
   amount:=nullif(p_data->>'owner_claim_amount','')::numeric;
   select total_amount into other from public.claims where id=x;
   if amount is null or amount<0 or amount>other or amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Enter the approved owner claim amount, no more than the existing claim cost'; end if;
  end if;
  insert into public.owner_portal_shares(owner_id,property_id,expense_id,claim_id,title,summary,reported_date,completed_date,chargeable,owner_claim_amount,billing_status,published_at,created_by)
  values(p_owner,prop,case when p_data->>'source_type'='expense' then x end,case when p_data->>'source_type'='claim' then x end,
   p_data->>'title',p_data->>'summary',nullif(p_data->>'reported','')::date,nullif(p_data->>'completed','')::date,coalesce((p_data->>'chargeable')::boolean,false),amount,p_data->>'status',now(),p_actor) returning id into rid;
 elsif p_action in ('agreement','statement') then
  select * into doc from public.owner_portal_documents where id=(p_data->>'document_id')::uuid and owner_id=p_owner and property_id=prop and published_at is not null and revoked_at is null;
  if doc.id is null then raise exception 'Select a published document for this owner/property'; end if;
  if p_action='agreement' then
   if doc.category<>'agreement' then raise exception 'Select an agreement document'; end if;
   insert into public.owner_portal_agreements(owner_id,property_id,document_id,start_date,end_date,management_fee)
   values(p_owner,prop,doc.id,(p_data->>'start')::date,(p_data->>'end')::date,p_data->>'fee') returning id into rid;
  else
   if doc.category<>'statement' then raise exception 'Select a statement document'; end if;
   if p_data::text ~ '(NaN|Infinity)' then raise exception 'Invalid numeric amounts'; end if;
   insert into public.owner_portal_statements(owner_id,property_id,period,document_id,rental_income,collected,outstanding,expenses,maintenance,management_fee,source_reference,approved_by)
   values(p_owner,prop,(p_data->>'period')::date,doc.id,(p_data->>'income')::numeric,(p_data->>'collected')::numeric,(p_data->>'outstanding')::numeric,(p_data->>'expenses')::numeric,(p_data->>'maintenance')::numeric,(p_data->>'fee_amount')::numeric,p_data->>'source_reference',p_actor) returning id into rid;
  end if;
 elsif p_action='payout' then
  select * into stmt from public.owner_portal_statements where id=(p_data->>'statement_id')::uuid and owner_id=p_owner for update;
  if stmt.id is null then raise exception 'Statement not found'; end if;
  select * into bank from public.bank_statement_lines where id=(p_data->>'bank_line_id')::uuid for update;
  if bank.id is null or bank.amount>=0 or bank.status not in ('matched','adjusted') then raise exception 'Select an already reconciled outgoing bank transaction'; end if;
  if not exists(select 1 from public.bank_statement_imports i join public.properties p on p.company_id=i.company_id where i.id=bank.statement_import_id and p.id=stmt.property_id) then raise exception 'Bank source belongs to another company'; end if;
  amount:=(p_data->>'amount')::numeric;
  if amount is null or amount<=0 or amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid payout amount'; end if;
  select coalesce(sum(l.amount),0) into other from public.owner_portal_payout_links l where l.bank_line_id=bank.id;
  if other+amount>abs(bank.amount) then raise exception 'Bank source already represented'; end if;
  select coalesce(sum(l.amount),0) into other from public.owner_portal_payout_links l where l.statement_id=stmt.id;
  if other+amount>stmt.net_payout then raise exception 'Payout exceeds statement'; end if;
  x:=nullif(p_data->>'proof_document_id','')::uuid;
  if x is not null and not exists(select 1 from public.owner_portal_documents where id=x and owner_id=p_owner and (property_id is null or property_id=stmt.property_id) and published_at is not null and revoked_at is null) then raise exception 'Invalid payment proof'; end if;
  insert into public.owner_portal_payout_links(statement_id,bank_line_id,amount,proof_document_id,approved_by) values(stmt.id,bank.id,amount,x,p_actor) returning id into rid;
 else raise exception 'Unknown publication action'; end if;
 insert into public.owner_portal_audit(owner_id,actor_id,action,record_id,details) values(p_owner,p_actor,p_action,rid,p_data);
 return rid;
end $$;
revoke all on function public.manage_client_owner(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.manage_client_owner(uuid,uuid,text,jsonb) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('owner-portal-files','owner-portal-files',false,3145728,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do nothing;
