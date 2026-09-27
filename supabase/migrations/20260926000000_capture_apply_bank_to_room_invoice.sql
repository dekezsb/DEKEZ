-- This function already exists and is already live in production - it is the
-- "direct bank-to-invoice match" exception documented in AGENTS.md. It was
-- never captured in this migrations folder (the same kind of gap already
-- known for the tenancies/tenants baseline schema), so a fresh environment
-- rebuilt from these migrations alone would be missing it entirely. This
-- migration only records its existing, already-verified-against-production
-- definition (create or replace, byte-for-byte from the live database as of
-- 2026-09-26) for reproducibility - it changes no behaviour.
create or replace function public.apply_bank_to_room_invoice(p_company uuid, p_actor uuid, p_line uuid, p_bill uuid, p_kind text)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  b public.rent_bills%rowtype;
  l public.bank_statement_lines%rowtype;
  s public.bank_statement_imports%rowtype;
  r public.smart_meter_top_up_requests%rowtype;
  payment_id uuid;
  candidates uuid[];
  request_ids uuid[];
  locations text[];
  invoice_location text;
  extras numeric;
  deposit_paid numeric;
  new_paid numeric;
  new_status public.bill_status;
begin
  if p_company is null or p_actor is null or p_kind is null
    or p_kind not in ('monthly_rent','top_up_utilities')
    or not exists(select 1 from public.profiles where id=p_actor and role in ('super_admin','admin','owner'))
    then raise exception 'invoice_bank_not_authorized'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
  select line.* into l from public.bank_statement_lines line
    join public.bank_statement_imports statement on statement.id=line.statement_import_id
    where line.id=p_line and statement.company_id=p_company for update of line;
  if l.id is null or l.amount<=0 or l.status<>'unmatched'
    or exists(select 1 from public.bank_reconciliation_matches where statement_line_id=p_line)
    then raise exception 'Possible duplicate transaction. Please review.'; end if;
  select * into s from public.bank_statement_imports where id=l.statement_import_id for share;
  if s.status<>'in_progress' then raise exception 'invoice_bank_statement_locked'; end if;
  perform 1 from public.accounting_periods where company_id=p_company
    and l.transaction_date between period_start and period_end for share;
  if exists(select 1 from public.accounting_periods where company_id=p_company and status='locked'
    and l.transaction_date between period_start and period_end)
    then raise exception 'invoice_bank_period_locked'; end if;
  -- Lock a potentially related top-up request before its invoice (meter flow lock order).
  if p_kind='top_up_utilities' then
    select array_agg(request.id) into request_ids from public.smart_meter_top_up_requests request
      join public.rent_bills bill on bill.property_id=request.property_id and bill.room_id=request.room_id
      where bill.id=p_bill and request.bill_month=bill.bill_month and request.amount=l.amount
        and request.status in ('pending_verification','approved_awaiting_top_up','credited');
    if cardinality(request_ids)>1 then raise exception 'invoice_bank_duplicate_top_up'; end if;
    if cardinality(request_ids)=1 then
      select * into r from public.smart_meter_top_up_requests where id=request_ids[1] for update;
    end if;
  end if;
  select bill.* into b from public.rent_bills bill join public.properties property on property.id=bill.property_id
    where bill.id=p_bill and property.company_id=p_company for update of bill;
  if b.id is null or b.removed_at is not null or b.status in ('cancelled','waived')
    or date_trunc('month',b.bill_month)<>date_trunc('month',l.transaction_date)
    or date_trunc('month',b.bill_month)<>date_trunc('month',s.period_start)
    then raise exception 'invoice_bank_wrong_month'; end if;
  -- Reject conflicting room references rather than trusting only the first token.
  select array_agg(distinct m[1]||':'||regexp_replace(m[2],'^0+(?=[0-9])','')) into locations
    from regexp_matches(upper(coalesce(l.reference_number,'')||' '||coalesce(l.description,'')),
      '\m(PTT|DGG|BDS|BVH|INS|HLT|KLB|SLY|MGT|SLS)\s*[-–—]?\s*(?:ROOM\s*)?([A-Z]?[0-9]+[A-Z]?)\M','g') m;
  select upper(property.property_code)||':'||regexp_replace(regexp_replace(upper(room.room_number),'^ROOM\s*',''),'^0+(?=[0-9])','')
    into invoice_location from public.properties property join public.rooms room on room.property_id=property.id
    where property.id=b.property_id and room.id=b.room_id;
  if coalesce(cardinality(locations),0)<>1 or invoice_location is null or locations[1]<>invoice_location
    then raise exception 'invoice_bank_wrong_room'; end if;
  if r.id is not null and (r.tenancy_id is distinct from b.tenancy_id or r.payment_date<>l.transaction_date)
    then raise exception 'invoice_bank_duplicate_top_up_review'; end if;
  -- Reuse the original record on retries after an authorized unmatch, or an exact
  -- existing payment. A payment belonging to another invoice is never relabelled.
  select array_agg(p.id) into candidates from public.payments p
    where p.company_id=p_company and p.status='confirmed' and p.reversed_at is null
      and (p.origin_bank_line_id=p_line or (p.rent_bill_id=b.id and p.amount=l.amount
        and date_trunc('month',p.payment_date)=date_trunc('month',b.bill_month)
        and (p.payment_date=l.transaction_date or p.smart_meter_top_up_request_id=r.id
          or (nullif(btrim(l.reference_number),'') is not null and p.reference_number=l.reference_number))));
  if cardinality(candidates)>1 then raise exception 'invoice_bank_duplicate_existing_payment'; end if;
  if cardinality(candidates)=1 then
    if not exists(select 1 from public.payments p where p.id=candidates[1] and p.rent_bill_id=b.id
      and p.category=p_kind and p.amount=l.amount)
      then raise exception 'invoice_bank_existing_payment_review'; end if;
    perform public.reconcile_existing_tenant_payment(p_company,p_line,candidates[1],p_actor);
    return candidates[1];
  end if;
  -- Never manufacture a replacement for a submitted slip or a reversed payment.
  if exists(select 1 from public.payment_submissions ps where ps.property_id=b.property_id and ps.room_id=b.room_id
      and ps.bill_month=b.bill_month and ps.verification_status in ('pending_verification','verified')
      and (ps.amount=l.amount or ps.payment_date=l.transaction_date)
      and not exists(select 1 from public.payments p where p.payment_submission_id=ps.id and p.status='confirmed' and p.reversed_at is null))
    then raise exception 'invoice_bank_existing_slip'; end if;
  if exists(select 1 from public.payments p where p.company_id=p_company and p.rent_bill_id=b.id
    and (p.origin_bank_line_id=p_line or (p.amount=l.amount and p.payment_date=l.transaction_date)))
    then raise exception 'invoice_bank_duplicate_existing_payment'; end if;
  if r.id is not null and exists(select 1 from public.payments where smart_meter_top_up_request_id=r.id)
    then raise exception 'invoice_bank_existing_payment_review'; end if;
  select coalesce(sum(amount),0) into extras from public.rental_invoice_line_items where rent_bill_id=b.id;
  if p_kind='monthly_rent' and l.amount>greatest(b.amount+extras-coalesce(b.paid_amount,0),0)
    then raise exception 'invoice_bank_exceeds_balance'; end if;
  if p_kind='top_up_utilities' then
    if exists(select 1 from public.rental_invoice_line_items where rent_bill_id=b.id
      and category in ('electricity','top_up_utilities') and amount=l.amount
      and (origin_bank_line_id is null or origin_bank_line_id=p_line))
      then raise exception 'invoice_bank_existing_charge'; end if;
    insert into public.rental_invoice_line_items(rent_bill_id,category,description,amount,created_by,
      origin_bank_line_id,smart_meter_top_up_request_id)
      values(b.id,'top_up_utilities','Electricity top-up · bank '||coalesce(nullif(l.reference_number,''),left(l.id::text,8)),
        l.amount,p_actor,l.id,r.id);
    extras:=extras+l.amount;
  end if;
  insert into public.payments(company_id,organization_id,tenant_id,tenancy_id,property_id,unit_id,room_id,rent_bill_id,
    category,amount,payment_date,payment_method,reference_number,notes,status,recorded_by,verified_by,verified_at,
    origin_bank_line_id,smart_meter_top_up_request_id)
    values(p_company,b.organization_id,b.tenant_id,b.tenancy_id,b.property_id,b.unit_id,b.room_id,b.id,p_kind,l.amount,
      l.transaction_date,'bank_transfer',coalesce(nullif(l.reference_number,''),'BANK-'||left(l.id::text,8)),
      'Bank evidence applied directly to monthly invoice; no replacement receipt.','confirmed',p_actor,p_actor,now(),l.id,r.id)
    returning id into payment_id;
  new_paid:=coalesce(b.paid_amount,0)+l.amount;
  select coalesce(sum(amount),0) into deposit_paid from public.payments where tenancy_id=b.tenancy_id
    and category='deposit' and status='confirmed' and reversed_at is null;
  new_status:=case when new_paid+deposit_paid>=b.amount+extras+coalesce(b.deposit_amount,0)
    then 'paid'::public.bill_status else 'partially_paid'::public.bill_status end;
  update public.rent_bills set paid_amount=new_paid,status=new_status,updated_at=now() where id=b.id;
  if r.id is not null then
    update public.smart_meter_top_up_requests set rent_bill_id=b.id,updated_at=now() where id=r.id;
  end if;
  -- Existing reconciliation guard checks duplicated bank IDs, payment IDs and bank fingerprints.
  -- Any failure rolls back the new line and payment together.
  perform public.reconcile_existing_tenant_payment(p_company,p_line,payment_id,p_actor);
  insert into public.rent_bill_audit_logs(bill_id,action,performed_by,old_status,new_status,old_paid_amount,new_paid_amount,reason)
    values(b.id,'bank_invoice_payment',p_actor,b.status,new_status,b.paid_amount,new_paid,
      'Bank statement evidence; '||p_kind||'; bank line '||l.id::text);
  insert into public.accounting_audit_logs(company_id,entity_type,entity_id,action,after_data,reason,performed_by)
    values(p_company,'bank_statement_line',l.id,'bank_invoice_payment',
      jsonb_build_object('rent_bill_id',b.id,'payment_id',payment_id,'purpose',p_kind,'amount',l.amount,'top_up_request_id',r.id),
      'Explicit invoice allocation. Existing records checked; bank evidence retained.',p_actor);
  return payment_id;
end;
$$;

revoke all on function public.apply_bank_to_room_invoice(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.apply_bank_to_room_invoice(uuid,uuid,uuid,uuid,text) to service_role;
