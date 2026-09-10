create or replace function public.verify_payment_folder_slip(p_submission uuid,p_actor uuid,p_decision text,p_reason text default null)
returns void language plpgsql security invoker set search_path='' as $$
declare s public.payment_submissions%rowtype; b public.rent_bills%rowtype; t public.tenancies%rowtype;
 dep_required numeric; dep_paid numeric; rent_required numeric; old_paid numeric; new_status public.bill_status;
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
   new_status:=case when old_paid>=rent_required and dep_paid>=dep_required then 'paid'::public.bill_status else 'partially_paid'::public.bill_status end;
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
