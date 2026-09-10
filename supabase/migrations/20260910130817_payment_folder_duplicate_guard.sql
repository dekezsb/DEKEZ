alter table public.payment_submissions add column if not exists receipt_sha256 text;
create index if not exists payment_submission_receipt_hash on public.payment_submissions(receipt_sha256) where receipt_sha256 is not null;
create or replace function public.record_payment_folder_slip(p_bill uuid,p_actor uuid,p_item jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare b public.rent_bills%rowtype; existing uuid; result uuid; scope_id uuid;
begin
 select * into strict b from public.rent_bills where id=p_bill for update;
 scope_id:=coalesce(b.tenancy_id,b.tenant_record_id,b.id);
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(scope_id::text,0));
 if p_actor is null or b.status in ('cancelled','waived') then raise exception 'Bill unavailable'; end if;
 select id into existing from public.payment_submissions where submission_key=(p_item->>'key')::uuid and rent_bill_id=b.id;
 if existing is not null then return existing; end if;
 if (p_item->>'amount')::numeric<=0 or p_item->>'purpose' not in ('monthly_rent','deposit')
 or coalesce(p_item->>'hash','') !~ '^[0-9a-f]{64}$'
 or nullif(p_item->>'path','') is null then raise exception 'Invalid slip'; end if;
 if exists(select 1 from public.payment_submissions s where s.verification_status<>'rejected'
 and (s.rent_bill_id=b.id or (b.tenancy_id is not null and s.tenancy_id=b.tenancy_id) or (b.tenant_record_id is not null and s.tenant_record_id=b.tenant_record_id))
 and (s.receipt_sha256=p_item->>'hash' or (nullif(regexp_replace(p_item->>'reference','[^a-zA-Z0-9]','','g'),'') is not null and
 upper(regexp_replace(coalesce(s.reference_number,''),'[^a-zA-Z0-9]','','g'))=upper(regexp_replace(p_item->>'reference','[^a-zA-Z0-9]','','g')))))
 then raise exception 'Duplicate payment slip or bank reference'; end if;
 insert into public.payment_submissions(tenant_id,tenant_record_id,tenancy_id,rent_bill_id,property_id,unit_id,room_id,bill_month,bill_type,payment_type,
 amount,payment_date,payment_method,reference_number,receipt_url,verification_status,instalment,submission_key,payment_note,receipt_sha256)
 values(coalesce(b.tenant_id,(p_item->>'tenant_id')::uuid),coalesce(b.tenant_record_id,(p_item->>'tenant_record_id')::uuid),b.tenancy_id,b.id,b.property_id,b.unit_id,b.room_id,b.bill_month,
 p_item->>'purpose',p_item->>'purpose',(p_item->>'amount')::numeric,(p_item->>'date')::date,'bank_transfer',nullif(btrim(p_item->>'reference'),''),p_item->>'path','pending_verification',true,
 (p_item->>'key')::uuid,nullif(p_item->>'note',''),p_item->>'hash') returning id into result;
 insert into public.payment_attachments(payment_submission_id,tenant_id,tenant_record_id,file_path,file_name,content_type)
 values(result,coalesce(b.tenant_id,(p_item->>'tenant_id')::uuid),coalesce(b.tenant_record_id,(p_item->>'tenant_record_id')::uuid),p_item->>'path',p_item->>'file_name',p_item->>'content_type');
 insert into public.audit_logs(action,entity_table,entity_id,metadata)
 values('payment_folder_slip_added','payment_submissions',result,jsonb_build_object('actor',p_actor,'bill_id',b.id,'similar_payment_confirmed',coalesce((p_item->>'similar_confirmed')::boolean,false)));
 return result;
end;
$$;
revoke all on function public.record_payment_folder_slip(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_payment_folder_slip(uuid,uuid,jsonb) to service_role;

create or replace function public.verify_payment_folder_slip(p_submission uuid,p_actor uuid,p_decision text,p_reason text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare s public.payment_submissions%rowtype; b public.rent_bills%rowtype; t public.tenancies%rowtype;
 dep_required numeric; dep_paid numeric; rent_required numeric; old_paid numeric; new_status text;
begin
 select * into strict s from public.payment_submissions where id=p_submission for update;
 if p_actor is null or p_decision not in ('verified','rejected') or s.receipt_sha256 is null then raise exception 'Invalid review'; end if;
 if s.verification_status='verified' then return; end if;
 if s.verification_status<>'pending_verification' then raise exception 'Payment no longer pending'; end if;
 if p_decision='rejected' then
   if nullif(btrim(p_reason),'') is null then raise exception 'Rejection reason required'; end if;
   update public.payment_submissions set verification_status='rejected',rejection_reason=p_reason,updated_at=now() where id=s.id;
 else
   select * into strict b from public.rent_bills where id=s.rent_bill_id for update;
   select * into strict t from public.tenancies where id=s.tenancy_id for update;
   if b.status in ('cancelled','waived') or b.tenancy_id<>s.tenancy_id or s.payment_type not in ('monthly_rent','deposit') or s.amount<=0 then raise exception 'Invoice requires manual review'; end if;
   if exists(select 1 from public.payments where payment_submission_id=s.id and reversed_at is null and status in ('confirmed','paid')) then raise exception 'Payment already recorded; review history'; end if;
   dep_required:=greatest(coalesce(t.deposit,0),coalesce(b.deposit_amount,0));
   select coalesce(sum(amount),0) into dep_paid from public.payments where tenancy_id=t.id and category in ('deposit','rental_deposit','security_deposit','utility_deposit') and status in ('confirmed','paid') and reversed_at is null;
   if dep_paid=0 then
     select coalesce(sum(amount),0) into dep_paid from public.payment_submissions where tenancy_id=t.id and payment_type in ('deposit','rental_deposit','security_deposit','utility_deposit') and verification_status='verified';
   end if;
   select coalesce(b.amount,0)+coalesce(sum(amount),0) into rent_required from public.rental_invoice_line_items where rent_bill_id=b.id;
   old_paid:=coalesce(b.paid_amount,0);
   if s.amount > (case when s.payment_type='deposit' then greatest(dep_required-dep_paid,0) else greatest(rent_required-old_paid,0) end) then raise exception 'Amount exceeds balance; use allocation review'; end if;
   insert into public.payments(company_id,organization_id,payment_submission_id,rent_bill_id,tenant_id,tenancy_id,property_id,unit_id,room_id,
    category,amount,payment_date,payment_method,reference_number,status,recorded_by,verified_by,verified_at,notes)
   values(t.company_id,t.organization_id,s.id,b.id,s.tenant_id,t.id,s.property_id,s.unit_id,s.room_id,s.payment_type,s.amount,s.payment_date,s.payment_method,s.reference_number,'confirmed',p_actor,p_actor,now(),'Verified payment folder slip');
   if s.payment_type='deposit' then dep_paid:=dep_paid+s.amount; else old_paid:=old_paid+s.amount; end if;
   new_status:=case when old_paid>=rent_required and dep_paid>=dep_required then 'paid' else 'partially_paid' end;
   update public.rent_bills set paid_amount=old_paid,status=new_status,updated_at=now() where id=b.id;
   update public.payment_submissions set verification_status='verified',verified_by=p_actor,verified_at=now(),rejection_reason=null,updated_at=now() where id=s.id;
   insert into public.rent_bill_audit_logs(bill_id,action,performed_by,old_status,new_status,old_paid_amount,new_paid_amount,reason)
    values(b.id,'verify_payment_submission',p_actor,b.status,new_status,b.paid_amount,old_paid,'Payment folder: '||s.id::text);
 end if;
 insert into public.payment_verification_audit_logs(payment_submission_id,action,performed_by,old_status,new_status,reason)
 values(s.id,p_decision,p_actor,s.verification_status,p_decision,coalesce(p_reason,'Bank transfer checked in monthly payment folder'));
end;
$$;
revoke all on function public.verify_payment_folder_slip(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.verify_payment_folder_slip(uuid,uuid,text,text) to service_role;
