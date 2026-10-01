-- Reference rule only. Do not touch verification, invoice, receipt or AR state.
--
-- Aligns folder uploads (record_payment_folder_slip, from
-- 20260910130817_payment_folder_duplicate_guard.sql) with the invoice-level
-- bank-code rule in guard_payment_reference_change() (20261001120000), approved
-- 2026-10-01. The upload previously rejected any slip whose bank code matched
-- another live slip on the same tenancy or tenant record, so one transfer could
-- not be shared across different invoices of that tenancy. It also never checked
-- the bank amount, because the guard trigger only fires on UPDATE of the code.
--
-- Now: the slip is inserted without a code and the code is then set in the same
-- transaction, so the one guard trigger applies the same rule as Save/Verify:
-- duplicate_bank_reference only for the same invoice / payment, and
-- bank_reference_exceeds_amount once the total under the code exceeds the real
-- bank transaction. Any failure rolls back the whole upload (slip, attachment,
-- audit). The same-file (receipt hash) duplicate check is unchanged.
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
 and s.receipt_sha256=p_item->>'hash')
 then raise exception 'Duplicate payment slip or bank reference'; end if;
 insert into public.payment_submissions(tenant_id,tenant_record_id,tenancy_id,rent_bill_id,property_id,unit_id,room_id,bill_month,bill_type,payment_type,
 amount,payment_date,payment_method,reference_number,receipt_url,verification_status,instalment,submission_key,payment_note,receipt_sha256)
 values(coalesce(b.tenant_id,(p_item->>'tenant_id')::uuid),coalesce(b.tenant_record_id,(p_item->>'tenant_record_id')::uuid),b.tenancy_id,b.id,b.property_id,b.unit_id,b.room_id,b.bill_month,
 p_item->>'purpose',p_item->>'purpose',(p_item->>'amount')::numeric,(p_item->>'date')::date,'bank_transfer',null,p_item->>'path','pending_verification',true,
 (p_item->>'key')::uuid,nullif(p_item->>'note',''),p_item->>'hash') returning id into result;
 -- Set the code through the shared guard trigger (same invoice/payment duplicate
 -- key and bank-amount cap as Save/Verify).
 if nullif(btrim(p_item->>'reference'),'') is not null then
   update public.payment_submissions set reference_number=btrim(p_item->>'reference') where id=result;
 end if;
 insert into public.payment_attachments(payment_submission_id,tenant_id,tenant_record_id,file_path,file_name,content_type)
 values(result,coalesce(b.tenant_id,(p_item->>'tenant_id')::uuid),coalesce(b.tenant_record_id,(p_item->>'tenant_record_id')::uuid),p_item->>'path',p_item->>'file_name',p_item->>'content_type');
 insert into public.audit_logs(action,entity_table,entity_id,metadata)
 values('payment_folder_slip_added','payment_submissions',result,jsonb_build_object('actor',p_actor,'bill_id',b.id,'similar_payment_confirmed',coalesce((p_item->>'similar_confirmed')::boolean,false)));
 return result;
end;
$$;
revoke all on function public.record_payment_folder_slip(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_payment_folder_slip(uuid,uuid,jsonb) to service_role;
