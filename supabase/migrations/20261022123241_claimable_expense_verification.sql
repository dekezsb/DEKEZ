-- Expense Bills reuse the existing 2100 operational AP ledger. No historical
-- expenses, payments, journals or bank transactions are rewritten by installation.
create or replace function public.assert_expense_actor(p_company uuid,p_actor uuid,p_review boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare r text;
begin
 select role::text into r from public.profiles where id=p_actor;
 if p_company is null or not exists(select 1 from public.companies where id=p_company)
 or r is null or r not in ('super_admin','admin','owner','technician','maintenance_staff','cleaning_staff')
 or (p_review and r not in ('super_admin','admin','owner'))
 or (r not in ('super_admin','admin') and not exists(select 1 from public.company_users
   where company_id=p_company and coalesce(user_id,profile_id)=p_actor and status='active')
   and not exists(select 1 from public.companies where id=p_company and created_by=p_actor))
 or exists(select 1 from public.user_module_permissions where profile_id=p_actor and module_key='expenses' and access_level<>'manage')
 then raise exception 'expense_not_authorized'; end if;
end $$;

create or replace function public.validate_expense_bill(p_company uuid,p_actor uuid,p_bill jsonb,p_review boolean)
returns void language plpgsql security invoker set search_path='' as $$
declare prop uuid:=nullif(p_bill->>'property_id','')::uuid; claimant uuid:=nullif(p_bill->>'paid_by','')::uuid;
 claim uuid:=nullif(p_bill->>'claim_id','')::uuid; r text;
begin
 perform public.assert_expense_actor(p_company,p_actor,p_review);
 if p_bill->>'funding_source' is null or p_bill->>'funding_source' not in ('company_cash','company_bank','staff_personal')
 or coalesce((p_bill->>'amount')::numeric,0)<=0 or (p_bill->>'amount')::numeric::text in ('NaN','Infinity','-Infinity')
 or coalesce((p_bill->>'tax_amount')::numeric,0)<0 or coalesce((p_bill->>'tax_amount')::numeric,0)>(p_bill->>'amount')::numeric
 or nullif(p_bill->>'expense_date','') is null then raise exception 'invalid_expense_bill'; end if;
 if p_review and nullif(p_bill->>'category_id','') is null then raise exception 'category_required_before_posting'; end if;
 if nullif(p_bill->>'category_id','') is not null and not exists(select 1 from public.expense_categories
   where id=(p_bill->>'category_id')::uuid and (company_id is null or company_id=p_company)) then raise exception 'invalid_category'; end if;
 if prop is not null and not exists(select 1 from public.properties where id=prop and company_id=p_company) then raise exception 'invalid_property'; end if;
 if nullif(p_bill->>'unit_id','') is not null and not exists(select 1 from public.units where id=(p_bill->>'unit_id')::uuid and property_id=prop) then raise exception 'invalid_unit'; end if;
 if nullif(p_bill->>'room_id','') is not null and not exists(select 1 from public.rooms where id=(p_bill->>'room_id')::uuid and property_id=prop
   and (nullif(p_bill->>'unit_id','') is null or unit_id=(p_bill->>'unit_id')::uuid)) then raise exception 'invalid_room'; end if;
 if nullif(p_bill->>'maintenance_ticket_id','') is not null and not exists(select 1 from public.maintenance_tickets t
   join public.properties p on p.id=t.property_id where t.id=(p_bill->>'maintenance_ticket_id')::uuid and p.company_id=p_company
   and (prop is null or t.property_id=prop)) then raise exception 'invalid_ticket'; end if;
 if p_bill->>'funding_source'='staff_personal' then
   select role::text into r from public.profiles where id=claimant;
   if r is null or r='tenant' or (r not in ('super_admin','admin') and not exists(select 1 from public.company_users
     where company_id=p_company and coalesce(user_id,profile_id)=claimant and status='active')) then raise exception 'invalid_claimant'; end if;
   if not p_review and claimant<>p_actor and not exists(select 1 from public.profiles where id=p_actor and role::text in ('super_admin','admin','owner')) then raise exception 'claimant_must_be_self'; end if;
 end if;
 if claim is not null and not exists(select 1 from public.claims c left join public.properties p on p.id=c.property_id
   where c.id=claim and coalesce(c.company_id,p.company_id)=p_company and c.status::text not in ('paid','rejected')
   and c.funding_source=p_bill->>'funding_source'
   and (p_bill->>'funding_source'<>'staff_personal' or c.submitted_by=claimant)) then raise exception 'invalid_claim_link'; end if;
 if p_review and exists(select 1 from public.accounting_periods where company_id=p_company
   and (p_bill->>'expense_date')::date between period_start and period_end and status='locked') then raise exception 'expense_period_locked'; end if;
end $$;

create or replace function public.submit_expense_bill(p_id uuid,p_company uuid,p_actor uuid,p_bill jsonb,p_receipt jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
begin
 perform public.validate_expense_bill(p_company,p_actor,p_bill,false);
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,2100));
 if exists(select 1 from public.expenses where id=p_id and company_id=p_company and uploaded_by=p_actor) then return p_id; end if;
 if nullif(p_receipt->>'file_path','') is null or p_receipt->>'file_path' not like p_actor::text||'/'||p_id::text||'/%'
 or p_receipt->>'content_type' not in ('application/pdf','image/jpeg','image/png','image/webp')
 or not exists(select 1 from storage.objects where bucket_id='expense-receipts' and name=p_receipt->>'file_path') then raise exception 'receipt_required'; end if;
 insert into public.expenses(id,company_id,property_id,unit_id,room_id,maintenance_ticket_id,claim_id,category_id,expense_date,amount,tax_amount,
 supplier,description,paid_by,payment_method,funding_source,charge_to,status,payment_status,tax_claimable,receipt_number,uploaded_by)
 values(p_id,p_company,nullif(p_bill->>'property_id','')::uuid,nullif(p_bill->>'unit_id','')::uuid,nullif(p_bill->>'room_id','')::uuid,
 nullif(p_bill->>'maintenance_ticket_id','')::uuid,nullif(p_bill->>'claim_id','')::uuid,nullif(p_bill->>'category_id','')::uuid,
 (p_bill->>'expense_date')::date,(p_bill->>'amount')::numeric,coalesce((p_bill->>'tax_amount')::numeric,0),p_bill->>'supplier',p_bill->>'description',
 case when p_bill->>'funding_source'='staff_personal' then (p_bill->>'paid_by')::uuid else p_actor end,
 p_bill->>'payment_method',p_bill->>'funding_source',p_bill->>'charge_to','pending_verification','unpaid',coalesce((p_bill->>'tax_claimable')::boolean,false),p_bill->>'receipt_number',p_actor);
 insert into public.expense_attachments(expense_id,file_path,file_name,content_type,uploaded_by)
 values(p_id,p_receipt->>'file_path',p_receipt->>'file_name',p_receipt->>'content_type',p_actor);
 insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,after_data,performed_by,reason)
 values(p_company,'expense',p_id,'submit_expense_bill',p_bill,p_actor,'Submission only; no expense or payable recognized until verification.');
 return p_id;
end $$;

create or replace function public.review_expense_bill(p_id uuid,p_actor uuid,p_version timestamptz,p_decision text,p_bill jsonb,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
declare e public.expenses%rowtype; cash_paid boolean;
begin
 select * into e from public.expenses where id=p_id for update;
 if e.id is null then raise exception 'expense_missing'; end if;
 perform public.assert_expense_actor(e.company_id,p_actor,true);
 if e.status not in ('pending_verification','draft') or e.updated_at is distinct from p_version then raise exception 'expense_changed_or_posted'; end if;
 if p_decision='rejected' then
   if nullif(btrim(p_reason),'') is null then raise exception 'rejection_reason_required'; end if;
   update public.expenses set status='rejected',rejection_reason=p_reason,updated_at=clock_timestamp() where id=p_id;
 elsif p_decision='verified' then
   perform public.validate_expense_bill(e.company_id,p_actor,p_bill,true);
   if not exists(select 1 from public.expense_attachments where expense_id=p_id) then raise exception 'receipt_required'; end if;
   if p_bill->>'funding_source'='staff_personal' and not exists(select 1 from public.accounting_accounts
     where company_id=e.company_id and system_key='staff_reimbursement_payable' and account_type='liability' and is_active) then raise exception 'claim_payable_mapping_missing'; end if;
   cash_paid:=p_bill->>'funding_source'='company_cash' and e.payment_method='cash';
   update public.expenses set status='verified',category_id=(p_bill->>'category_id')::uuid,amount=(p_bill->>'amount')::numeric,
     expense_date=(p_bill->>'expense_date')::date,property_id=nullif(p_bill->>'property_id','')::uuid,
     unit_id=nullif(p_bill->>'unit_id','')::uuid,room_id=nullif(p_bill->>'room_id','')::uuid,
     maintenance_ticket_id=nullif(p_bill->>'maintenance_ticket_id','')::uuid,
     funding_source=p_bill->>'funding_source',paid_by=case when p_bill->>'funding_source'='staff_personal' then (p_bill->>'paid_by')::uuid else e.paid_by end,
     charge_to=p_bill->>'charge_to',payment_status=case when cash_paid then 'paid' else 'unpaid' end,
     paid_at=case when cash_paid then now() end,verified_by=p_actor,verified_at=now(),updated_at=clock_timestamp()
   where id=p_id;
 else raise exception 'invalid_review'; end if;
 insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,performed_by,reason)
 values(e.company_id,'expense',p_id,'review_expense_bill',to_jsonb(e),(select to_jsonb(x) from public.expenses x where id=p_id),p_actor,
 coalesce(nullif(p_reason,''),'Admin reviewed category and payment source; operational expense recognized once.'));
end $$;

-- One allocation per payout/bill, allowing multiple partial repayments without
-- changing the original expense or creating another claim/payable concept.
create table public.staff_reimbursement_allocations(
 payout_id uuid not null references public.staff_reimbursement_payouts(id) on delete restrict,
 liability_id uuid not null references public.staff_reimbursement_liabilities(id) on delete restrict,
 amount numeric(12,2) not null check(amount>0),
 primary key(payout_id,liability_id)
);
alter table public.staff_reimbursement_payouts add column company_id uuid references public.companies(id) on delete restrict;
create index staff_reimbursement_allocations_liability_idx on public.staff_reimbursement_allocations(liability_id);
alter table public.staff_reimbursement_allocations enable row level security;
create policy reimbursement_allocations_read on public.staff_reimbursement_allocations for select to authenticated using
 (exists(select 1 from public.staff_reimbursement_liabilities l where l.id=liability_id));
revoke all on public.staff_reimbursement_allocations from public,anon,authenticated,service_role;
grant select on public.staff_reimbursement_allocations to authenticated;
grant select,insert on public.staff_reimbursement_allocations to service_role;
create function public.immutable_claim_allocation() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'claim_allocation_immutable'; end $$;
create trigger immutable_claim_allocation before update or delete on public.staff_reimbursement_allocations for each row execute function public.immutable_claim_allocation();
revoke all on function public.immutable_claim_allocation() from public,anon,authenticated;

create or replace view public.staff_reimbursement_balances with(security_invoker=true) as
 select l.id,l.claim_id,l.expense_id,l.staff_id,l.status,l.owed_at,l.paid_at,l.payout_id,l.created_at,l.updated_at,
 l.amount as original_amount,
 case when l.status='paid' then l.amount else coalesce(a.total,0) end as reimbursed_amount,
 case when l.status='paid' then 0 else greatest(0,l.amount-coalesce(a.total,0)) end as amount
 from public.staff_reimbursement_liabilities l left join
 (select liability_id,sum(amount) total from public.staff_reimbursement_allocations group by liability_id)a on a.liability_id=l.id;
revoke all on public.staff_reimbursement_balances from public,anon;
grant select on public.staff_reimbursement_balances to authenticated,service_role;

create or replace function public.protect_reimbursed_expense()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.staff_reimbursement_liabilities l where l.expense_id=old.id
   and (l.status='paid' or exists(select 1 from public.staff_reimbursement_allocations a where a.liability_id=l.id))) then
   if tg_op='DELETE' or (to_jsonb(new)-array['status','payment_status','paid_at','reimbursement_source','reimbursed_at','updated_at'])
     is distinct from (to_jsonb(old)-array['status','payment_status','paid_at','reimbursement_source','reimbursed_at','updated_at'])
     or (tg_op='UPDATE' and new.status not in ('verified','reimbursed')) then raise exception 'reimbursed_expense_immutable'; end if;
   if old.status='reimbursed' and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'reimbursed_expense_immutable'; end if;
 end if;
 if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger protect_reimbursed_expense before update or delete on public.expenses for each row execute function public.protect_reimbursed_expense();

create or replace function public.record_staff_reimbursement_partial(
 p_id uuid,target_staff_id uuid,p_allocations jsonb,payout_source text,payout_date date,payout_reference text,payout_notes text,
 payout_proof_bucket text,payout_proof_path text,payout_proof_content_type text,payout_recorded_by uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare l public.staff_reimbursement_liabilities%rowtype; e public.expenses%rowtype; item jsonb; n numeric; remaining numeric; total numeric:=0; company uuid;
begin
 if p_id is null or target_staff_id is null or payout_recorded_by is null or payout_source is null or payout_source not in ('company_cash','company_bank') or payout_date is null or coalesce(jsonb_array_length(p_allocations),0)=0
 or nullif(payout_proof_path,'') is null then raise exception 'invalid_reimbursement_payout'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,2101));
 if exists(select 1 from public.staff_reimbursement_payouts where id=p_id and recorded_by=payout_recorded_by and staff_id=target_staff_id) then return p_id; end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_allocations)x)<>jsonb_array_length(p_allocations) then raise exception 'duplicate_liability'; end if;
 -- Consistent lock order prevents two concurrent partial payments overspending AP.
 perform 1 from public.staff_reimbursement_liabilities where id in(select (x->>'id')::uuid from jsonb_array_elements(p_allocations)x) order by id for update;
 for item in select * from jsonb_array_elements(p_allocations) loop
   select * into l from public.staff_reimbursement_liabilities where id=(item->>'id')::uuid;
   select * into e from public.expenses where id=l.expense_id;
   if l.id is null or l.staff_id<>target_staff_id or l.status<>'owed' or e.status<>'verified' or e.funding_source<>'staff_personal' then raise exception 'reimbursement_items_changed'; end if;
   perform public.assert_expense_actor(e.company_id,payout_recorded_by,true);
   if not exists(select 1 from public.expense_attachments where expense_id=e.id) then raise exception 'receipt_required'; end if;
   if company is not null and company<>e.company_id then raise exception 'mixed_company_payout'; end if; company:=e.company_id;
   if payout_date<e.expense_date or exists(select 1 from public.accounting_periods where company_id=company and payout_date between period_start and period_end and status='locked') then raise exception 'payout_date_locked_or_before_bill'; end if;
   select amount into remaining from public.staff_reimbursement_balances where id=l.id;
   n:=coalesce((item->>'amount')::numeric,remaining);
   if n::text in ('NaN','Infinity','-Infinity') or n<=0 or n>remaining or n<>round(n,2) then raise exception 'invalid_partial_amount'; end if;
   total:=total+n;
 end loop;
 if not exists(select 1 from storage.objects where bucket_id=payout_proof_bucket and name=payout_proof_path) then raise exception 'payout_proof_required'; end if;
 insert into public.staff_reimbursement_payouts(id,company_id,staff_id,total_amount,payment_source,paid_on,reference_number,notes,proof_bucket_name,proof_file_path,proof_content_type,recorded_by)
 values(p_id,company,target_staff_id,total,payout_source,payout_date,nullif(payout_reference,''),nullif(payout_notes,''),payout_proof_bucket,payout_proof_path,payout_proof_content_type,payout_recorded_by);
 for item in select * from jsonb_array_elements(p_allocations) loop
   select * into l from public.staff_reimbursement_liabilities where id=(item->>'id')::uuid;
   select amount into remaining from public.staff_reimbursement_balances where id=l.id;
   n:=coalesce((item->>'amount')::numeric,remaining);
   insert into public.staff_reimbursement_allocations values(p_id,l.id,n);
   if n=remaining then
     update public.staff_reimbursement_liabilities set status='paid',payout_id=p_id,paid_at=now(),updated_at=now() where id=l.id;
     update public.expenses set status='reimbursed',payment_status='paid',paid_at=now(),reimbursement_source=payout_source,reimbursed_at=now(),updated_at=now() where id=l.expense_id;
     update public.claims set status='paid',updated_at=now() where id=l.claim_id;
   end if;
 end loop;
 insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,after_data,performed_by,reason)
 values(company,'staff_reimbursement_payout',p_id,'settle_claim_payable',jsonb_build_object('allocations',p_allocations,'amount',total,'source',payout_source,'date',payout_date),payout_recorded_by,'Settlement of existing 2100 payable only; no second expense.');
 return p_id;
end $$;

-- Existing full-payout callers use exactly the same locked allocation path.
create or replace function public.record_staff_reimbursement_payout(target_staff_id uuid,liability_ids uuid[],payout_source text,payout_date date,payout_reference text,payout_notes text,payout_proof_bucket text,payout_proof_path text,payout_proof_content_type text,payout_recorded_by uuid)
returns uuid language sql security invoker set search_path='' as $$
 select public.record_staff_reimbursement_partial(gen_random_uuid(),target_staff_id,
 (select jsonb_agg(jsonb_build_object('id',id)) from unnest(liability_ids)id),payout_source,payout_date,payout_reference,payout_notes,payout_proof_bucket,payout_proof_path,payout_proof_content_type,payout_recorded_by);
$$;

revoke all on function public.assert_expense_actor(uuid,uuid,boolean),public.validate_expense_bill(uuid,uuid,jsonb,boolean),public.submit_expense_bill(uuid,uuid,uuid,jsonb,jsonb),public.review_expense_bill(uuid,uuid,timestamptz,text,jsonb,text),public.record_staff_reimbursement_partial(uuid,uuid,jsonb,text,date,text,text,text,text,text,uuid),public.protect_reimbursed_expense() from public,anon,authenticated;
grant execute on function public.assert_expense_actor(uuid,uuid,boolean),public.validate_expense_bill(uuid,uuid,jsonb,boolean),public.submit_expense_bill(uuid,uuid,uuid,jsonb,jsonb),public.review_expense_bill(uuid,uuid,timestamptz,text,jsonb,text),public.record_staff_reimbursement_partial(uuid,uuid,jsonb,text,date,text,text,text,text,text,uuid) to service_role;

-- Match an existing bank debit and settle its AP in ONE transaction. This is
-- settlement, never a second expense or a new bank movement.
create function public.settle_staff_claims_from_bank(p_line uuid,p_actor uuid,p_staff uuid,p_ids uuid[],p_proof text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare bl public.bank_statement_lines%rowtype; remaining numeric; total numeric; allocations jsonb; payout uuid; n integer;
begin
 select * into bl from public.bank_statement_lines where id=p_line for update;
 if bl.id is null or bl.amount>=0 or bl.status in ('matched','adjusted','ignored') or bl.duplicate_of_line_id is not null then raise exception 'bank_line_unavailable'; end if;
 perform public.assert_expense_actor(bl.company_id,p_actor,true);
 if exists(select 1 from public.bank_statement_imports where id=bl.statement_import_id and status in ('completed','void')) then raise exception 'statement_not_open'; end if;
 select abs(bl.amount)-coalesce(sum(abs(matched_amount)),0) into remaining from public.bank_reconciliation_matches where statement_line_id=p_line;
 if remaining<=0 then raise exception 'bank_line_exhausted'; end if;
 perform 1 from public.staff_reimbursement_liabilities where id=any(p_ids) order by id for update;
 select count(*),sum(b.amount) into n,total from public.staff_reimbursement_balances b join public.expenses e on e.id=b.expense_id
 where b.id=any(p_ids) and b.staff_id=p_staff and b.status='owed' and e.company_id=bl.company_id;
 if n<>coalesce(cardinality(p_ids),0) or n=0 or total<remaining or (n>1 and total<>remaining) then raise exception 'claim_selection_changed'; end if;
 select jsonb_agg(jsonb_build_object('id',id,'amount',case when n=1 then remaining else amount end)) into allocations
 from public.staff_reimbursement_balances where id=any(p_ids);
 payout:=public.record_staff_reimbursement_partial(gen_random_uuid(),p_staff,allocations,'company_bank',bl.transaction_date,bl.reference_number,
 'Settlement from existing bank line '||bl.id::text,'reimbursement-proofs',p_proof,'application/json',p_actor);
 insert into public.bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,match_method,created_by)
 values(bl.id,'staff_reimbursement_payout',payout,-remaining,case when n>1 then 'merge' else 'manual' end,p_actor);
 update public.bank_statement_lines set status='matched' where id=bl.id;
 insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,before_data,after_data,performed_by,reason)
 values(bl.company_id,'bank_statement_line',bl.id,'settle_existing_claim_payable',to_jsonb(bl),jsonb_build_object('payout_id',payout,'allocations',allocations),p_actor,'Existing bank debit linked to claim payable; no new expense or bank entry.');
 return payout;
end $$;
revoke all on function public.settle_staff_claims_from_bank(uuid,uuid,uuid,uuid[],text) from public,anon,authenticated;
grant execute on function public.settle_staff_claims_from_bank(uuid,uuid,uuid,uuid[],text) to service_role;
