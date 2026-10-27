-- Read-only production review. Exact source CTE from the proposed migration.
-- No migration/RPC dependency, no provider calls or writes. Consent/ownership default unknown.
-- EVERY scoped group is redacted: no tenant names, full phones, source-record UUIDs or payment references.
 with params as (select '660cc0c4-daee-445b-9146-ccd112e791d4'::uuid company_id,current_timestamp as_of,(current_timestamp at time zone 'Asia/Kuala_Lumpur')::date report_date), profile_phones as materialized (
  -- Same accepted syntax and Malaysian local-number conversion as phone login.
  -- Only a single leading '+' is accepted, never silently strip an internal '+'.
  select p.id,case when raw.digits ~ '^01[0-9]{8,9}$' then '60'||substr(raw.digits,2)
   when raw.digits ~ '^[1-9][0-9]{7,14}$' then raw.digits else '' end phone
  from public.profiles p cross join lateral(select regexp_replace(btrim(coalesce(p.phone,'')),'[[:space:]().-]','','g') compact) cleaned
  cross join lateral(select case when cleaned.compact like '+%' then substr(cleaned.compact,2) else cleaned.compact end digits) raw
 ), source as materialized (
  select b.id,b.tenancy_id,b.tenant_id as bill_profile,b.tenant_record_id,b.property_id,b.room_id,b.invoice_number,b.due_date,
   b.amount base_amount,coalesce(li.total,0) extra_amount,b.paid_amount,b.status::text bill_status,b.tenant_facing,b.issued_at,b.invoice_date,b.bill_month,
   case when b.amount is not null and b.paid_amount is not null
    and b.amount::text not in ('NaN','Infinity','-Infinity') and b.paid_amount::text not in ('NaN','Infinity','-Infinity')
    and coalesce(li.total,0)::text not in ('NaN','Infinity','-Infinity') then greatest(b.amount+coalesce(li.total,0)-b.paid_amount,0) end outstanding,
   coalesce(person.profile_id,legacy_person.profile_id,b.tenant_id) tenant_id,
   coalesce(person.profile_id,legacy_person.profile_id,b.tenant_id)::text person_key,
   coalesce(p.full_name,person.full_name,legacy_person.full_name,'Unlinked tenant') tenant_name,
   p.phone profile_phone,p.normalized_phone profile_lookup_phone,coalesce(login.phone,'') portal_phone,
   person.phone tenant_phone,p.role::text profile_role,p.registration_status,
   tn.company_id tenancy_company,tn.status::text tenancy_status,tn.billing_status,tn.checkout_date,
   tn.property_id tenancy_property,tn.room_id tenancy_room,person.profile_id tenancy_profile,
   prop.name property_name,prop.property_code,coalesce(room.room_number,room.name) room_name,room.current_tenancy_id room_current_tenancy,
   coalesce(pay.verified,0) verified_paid,coalesce(pay.unallocated_credit,0) unallocated_credit,
   coalesce(pay.bad_scope,false) payment_scope_conflict,coalesce(pay.bad_submission,false) payment_submission_conflict,
   coalesce(pending.rows,'[]'::jsonb) pending,
   coalesce(pending.n,0)>0 or b.status::text in ('payment_submitted','pending_verification','submitted') pending_verification
  from public.rent_bills b join public.properties prop on prop.id=b.property_id and prop.company_id=(select company_id from params)
  left join public.rooms room on room.id=b.room_id and room.property_id=b.property_id
  left join public.tenancies tn on tn.id=b.tenancy_id
  left join public.tenants person on person.id=tn.tenant_id
  left join public.tenant_records legacy on legacy.id=b.tenant_record_id
  left join public.tenants legacy_person on legacy_person.id=legacy.tenant_id
  -- No phone fallback to legacy records, invoice profile, room occupant or staff.
  left join public.profiles p on p.id=person.profile_id
  left join profile_phones login on login.id=p.id
  left join lateral(select sum(i.amount) total from public.rental_invoice_line_items i where i.rent_bill_id=b.id) li on true
  left join lateral(
   select sum(v.amount) filter(where v.category in ('monthly_rent','key_lock','electricity','water','access_card','damage','cleaning','furniture','other','top_up_utilities')) verified,
    sum(v.amount) filter(where v.category='payment_credit') unallocated_credit,
    bool_or(v.company_id is distinct from (select company_id from params) or v.tenancy_id is distinct from b.tenancy_id or v.property_id is distinct from b.property_id or v.room_id is distinct from b.room_id) bad_scope,
    bool_or(v.payment_submission_id is not null and (ps.id is null or ps.verification_status is distinct from 'verified')) bad_submission
   from public.payments v left join public.payment_submissions ps on ps.id=v.payment_submission_id
   where v.rent_bill_id=b.id and v.status::text in ('confirmed','paid') and v.reversed_at is null
  ) pay on true
  left join lateral(
   select count(*) n,jsonb_agg(jsonb_build_object('id',s.id,'reference','Submission '||left(s.id::text,8),'status',s.verification_status) order by s.id) rows
   from public.payment_submissions s where s.verification_status in ('pending_verification','more_information_required')
    and (s.rent_bill_id=b.id or (s.rent_bill_id is null and s.tenancy_id=b.tenancy_id))
  ) pending on true
  where b.removed_at is null
 ), checked as (
  select s.*,coalesce(person_key,'invoice:'||id::text) tenant_key,(select report_date from params)-due_date days_overdue,
   portal_phone phone,
   array_remove(array[
    case when tenant_id is null or tenancy_id is null or tenancy_profile is distinct from tenant_id or bill_profile is distinct from tenant_id
     or tenancy_company is distinct from (select company_id from params) or tenancy_property is distinct from property_id or tenancy_room is distinct from room_id
     or profile_role is distinct from 'tenant' or registration_status is distinct from 'approved' then 'identity_or_scope' end,
    case when tenancy_status is distinct from 'active' or checkout_date is not null or billing_status is distinct from 'active' then 'inactive_or_checked_out' end,
    case when room_current_tenancy is distinct from tenancy_id then 'not_current_room_tenancy' end,
    case when profile_lookup_phone is null or (profile_lookup_phone is distinct from portal_phone
     and profile_lookup_phone is distinct from '0'||substr(portal_phone,3)) then 'portal_login_phone_mismatch' end,
    case when tenant_facing is distinct from true then 'internal_invoice' end,
    case when bill_status in ('draft','cancelled','waived') then 'non_collectible_invoice_state' end,
    case when regexp_replace(coalesce(tenant_phone,''),'[[:space:]().+-]','','g') not in
      (regexp_replace(coalesce(profile_phone,''),'[[:space:]().+-]','','g'),
       '0'||substr(regexp_replace(coalesce(profile_phone,''),'[[:space:]().+-]','','g'),3),
       '60'||substr(regexp_replace(coalesce(profile_phone,''),'[[:space:]().+-]','','g'),2)) then 'contact_phone_mismatch' end,
    case when issued_at is null or issued_at>(select as_of from params) or coalesce(invoice_date,bill_month)>(select report_date from params) then 'invoice_not_issued' end,
    case when due_date is null then 'missing_due_date' end,
    case when base_amount is null or paid_amount is null or base_amount<0 or paid_amount<0 or base_amount+extra_amount<0
     or base_amount::text in ('NaN','Infinity','-Infinity') or paid_amount::text in ('NaN','Infinity','-Infinity')
     or extra_amount::text in ('NaN','Infinity','-Infinity') or verified_paid::text in ('NaN','Infinity','-Infinity') then 'invalid_amount' end,
    case when abs(coalesce(paid_amount,0)-verified_paid)>0.005 then 'allocation_mismatch' end,
    case when payment_scope_conflict or payment_submission_conflict then 'payment_scope_or_verification' end,
    case when bill_status='paid' and outstanding>0.005 then 'paid_status_positive_balance' end,
    case when unallocated_credit>0.005 or exists(select 1 from public.payments v where v.tenancy_id=s.tenancy_id and v.category='payment_credit' and v.status::text in ('confirmed','paid') and v.reversed_at is null and v.amount>0) then 'unallocated_credit' end
   ],null) invoice_exceptions
  from source s
 ), classified as (
  -- A recorded amount is not automatically a verified, active collectible debt.
  -- Contact-only mismatch blocks sending but does not erase an established clock.
  select c.*,invoice_exceptions <@ array['contact_phone_mismatch','portal_login_phone_mismatch'] financially_collectible from checked c
 ), grouped as (
  select tenant_key,tenant_id,min(tenant_name) tenant_name,min(phone) phone,
   max(days_overdue) filter(where outstanding>0.005 and financially_collectible) days_overdue,
   max(days_overdue) filter(where outstanding>0.005) recorded_days_overdue,
   case when bool_or(outstanding is null) then null else sum(outstanding) end outstanding,
   coalesce(sum(outstanding) filter(where financially_collectible),0) collectible_outstanding,
   case when bool_or(outstanding is null and (days_overdue>=0 or days_overdue is null)) then null
    else coalesce(sum(outstanding) filter(where days_overdue>=0),0) end recorded_arrears_outstanding,
   coalesce(sum(outstanding) filter(where days_overdue>=0 and financially_collectible),0) arrears_outstanding,
   count(*) filter(where outstanding>0.005 and paid_amount>0.005) partial_invoices,
   bool_or(days_overdue=-7 and outstanding>0.005 and financially_collectible) advance_due,
   bool_or(pending_verification) pending_verification,
   jsonb_agg(jsonb_build_object('id',id,'tenancy_id',tenancy_id,'property_id',property_id,'room_id',room_id,
    'reference',coalesce(invoice_number,id::text),'property',property_name,'property_code',property_code,'room',room_name,
    'due_date',due_date,'days_overdue',days_overdue,
    'base_amount',case when base_amount::text not in ('NaN','Infinity','-Infinity') then base_amount end,
    'extra_amount',case when extra_amount::text not in ('NaN','Infinity','-Infinity') then extra_amount end,
    'paid_amount',case when paid_amount::text not in ('NaN','Infinity','-Infinity') then paid_amount end,
    'verified_paid',case when verified_paid::text not in ('NaN','Infinity','-Infinity') then verified_paid end,
    'outstanding',outstanding,'status',bill_status,'collectible',financially_collectible,
    'pending',pending,'exceptions',to_jsonb(invoice_exceptions)) order by due_date nulls first,id) invoices,
   coalesce((select jsonb_agg(distinct e) from classified c cross join lateral unnest(c.invoice_exceptions) e where c.tenant_key=g.tenant_key
    and (c.outstanding>0.005 or c.outstanding is null or c.invoice_exceptions && array['invalid_amount','allocation_mismatch','payment_scope_or_verification','unallocated_credit'])),'[]'::jsonb) exceptions,
   coalesce((select jsonb_agg(distinct p) from classified c cross join lateral jsonb_array_elements(c.pending) p where c.tenant_key=g.tenant_key),'[]'::jsonb) pending
  from classified g group by tenant_key,tenant_id
 ), guarded as (
  select g.*,jsonb_build_object('enabled',false,'compliance_approved',false,'opt_out_ready',false,'approved_recipient',null,'ownership_recipient',null,'ownership_verified',false,'consent','unknown','hold','none') policy,
   exceptions || case when phone !~ '^[1-9][0-9]{8,14}$' then '["invalid_phone"]'::jsonb else '[]'::jsonb end
    || case when phone<>'' and exists(select 1 from profile_phones other where other.id is distinct from g.tenant_id and other.phone=g.phone)
       then '["shared_phone"]'::jsonb else '[]'::jsonb end
    || case when exists(select 1 from public.whatsapp_conversations w where w.normalized_phone=g.phone and w.status='blocked')
       then '["blocked_contact"]'::jsonb else '[]'::jsonb end
    || case when exists(select 1 from public.rent_reminder_logs old where old.channel='whatsapp' and old.tenant_id=g.tenant_id
       and (old.sent_at at time zone 'Asia/Kuala_Lumpur')::date=(select report_date from params)) then '["legacy_message_today"]'::jsonb else '[]'::jsonb end all_exceptions,
   case when outstanding is null then 'exception'
    when outstanding<=0.005 then case when jsonb_array_length(exceptions)=0 and not pending_verification then 'resolved' else 'exception' end
    when collectible_outstanding<=0.005 then 'exception'
    when days_overdue is null then 'exception' when days_overdue>=15 then 'overdue_15_plus'
    when days_overdue=14 then 'day_14_review' when days_overdue>=8 then 'overdue_8_13'
    when days_overdue=7 then 'day_7_review' when days_overdue>=1 then 'overdue_1_6'
    when days_overdue=0 then 'due_today' when advance_due then 'advance_7' else 'tracking' end stage
  from grouped g
 ), communication_checked as (
  select g.*,phone ~ '^[1-9][0-9]{8,14}$' phone_valid,
   phone in ('60198894911','60168173911','60188702371') protected_recipient,
   coalesce((policy->>'ownership_verified')::boolean and policy->>'ownership_recipient'=phone,false) whatsapp_ownership_verified,
   to_jsonb(array_remove(array[
    case when phone='' then 'portal_login_phone_missing' when phone !~ '^[1-9][0-9]{8,14}$' then 'invalid_phone' end,
    case when phone in ('60198894911','60168173911','60188702371') then 'protected_recipient' end,
    case when all_exceptions ? 'shared_phone' then 'shared_phone' end,
    case when all_exceptions ? 'blocked_contact' then 'blocked_contact' end,
    case when all_exceptions ? 'legacy_message_today' then 'legacy_message_today' end,
    case when jsonb_array_length(exceptions)>0 then 'scope_or_reconciliation_review' end,
    case when pending_verification then 'payment_verification_pending' end,
    case when policy->>'consent'='opted_out' then 'opted_out' when policy->>'consent'<>'opted_in' then 'consent_missing' end,
    case when policy->>'consent'='opted_in' and policy->>'approved_recipient' is distinct from phone then 'consent_number_mismatch' end,
    case when not coalesce((policy->>'ownership_verified')::boolean and policy->>'ownership_recipient'=phone,false) then 'whatsapp_ownership_unverified' end,
    case when policy->>'hold'<>'none' then 'contact_hold' end,
    case when not (policy->>'enabled')::boolean then 'collection_disabled' end,
    case when not (policy->>'compliance_approved')::boolean then 'compliance_approval_missing' end,
    case when not (policy->>'opt_out_ready')::boolean then 'opt_out_not_ready' end
   ],null)) delivery_blocks
  from guarded g
 ), result as (
  select jsonb_build_object('company_id',(select company_id from params),'report_date',(select report_date from params),'key',tenant_key,'tenant_id',tenant_id,
   'name',tenant_name,'phone',phone,'stage',stage,'days_overdue',days_overdue,'outstanding',outstanding,
   'recipient_source','tenant_portal_login','masked_phone',case when phone ~ '^[1-9][0-9]{8,14}$' then '***'||right(phone,4) end,
   'phone_valid',phone_valid,'protected_recipient',protected_recipient,'whatsapp_ownership_verified',whatsapp_ownership_verified,'delivery_blocks',delivery_blocks,
   'recorded_days_overdue',recorded_days_overdue,'collectible_outstanding',collectible_outstanding,
   'recorded_arrears_outstanding',recorded_arrears_outstanding,
   'arrears_outstanding',arrears_outstanding,
   'arrears_resolved',arrears_outstanding<=0.005 and jsonb_array_length(exceptions)=0 and not pending_verification,
   'partial_invoices',partial_invoices,'invoices',invoices,'pending',pending,'pending_verification',pending_verification,
   'exceptions',all_exceptions,'policy',policy,
   'send_eligible',stage not in ('tracking','resolved','exception') and outstanding>0.005 and not pending_verification and jsonb_array_length(all_exceptions)=0
    and jsonb_array_length(delivery_blocks)=0 and phone_valid and not protected_recipient and whatsapp_ownership_verified
    and policy->>'consent'='opted_in' and policy->>'approved_recipient'=phone and policy->>'hold'='none'
    and (policy->>'enabled')::boolean and (policy->>'compliance_approved')::boolean and (policy->>'opt_out_ready')::boolean,
   'resolved',outstanding<=0.005 and jsonb_array_length(exceptions)=0 and not pending_verification) item
  from communication_checked
 ), stage_counts as (
 select item->>'stage' stage,count(*) groups,count(*) filter(where item->>'tenant_id' is not null) tenants,
 count(*) filter(where item->>'tenant_id' is null) unlinked_records,
 sum((item->>'collectible_outstanding')::numeric) amount,sum((item->>'outstanding')::numeric) recorded_amount,
 count(*) filter(where (item->>'outstanding')::numeric>0.005) positive_balance_groups,
 count(*) filter(where (item->>'partial_invoices')::int>0) partially_paid_groups,
 count(*) filter(where (item->>'pending_verification')::boolean) pending_verification_groups,
 count(*) filter(where jsonb_array_length(item->'exceptions')=0) reconciled_no_source_exception
 from result group by item->>'stage'
), exception_counts as (
 select e code,count(*) groups,count(*) filter(where item->>'tenant_id' is not null) tenants,
 count(*) filter(where item->>'tenant_id' is null) unlinked_records
 from result cross join lateral jsonb_array_elements_text(item->'exceptions') e group by e
), block_counts as (
 select e code,count(*) groups,count(*) filter(where item->>'tenant_id' is not null) tenants,
 count(*) filter(where item->>'tenant_id' is null) unlinked_records
 from result cross join lateral jsonb_array_elements_text(item->'delivery_blocks') e group by e
), redacted as (
 select jsonb_build_object('reference',left(md5(item->>'key'),10),'stage',item->>'stage',
 'recipient_source',item->'recipient_source','masked_phone',item->'masked_phone',
 'phone_valid',item->'phone_valid','protected_recipient',item->'protected_recipient',
 'whatsapp_ownership_verified',item->'whatsapp_ownership_verified','delivery_blocks',item->'delivery_blocks',
 'policy',jsonb_build_object('enabled',false,'consent','unknown','ownership_verified',false,'compliance_approved',false,'opt_out_ready',false),
 'days_overdue',item->'days_overdue','arrears_outstanding',item->'arrears_outstanding','outstanding',item->'outstanding',
 'collectible_outstanding',item->'collectible_outstanding','recorded_days_overdue',item->'recorded_days_overdue',
 'partial_invoices',item->'partial_invoices','pending_verification',item->'pending_verification','exceptions',item->'exceptions',
 'invoices',(select jsonb_agg((i - array['id','tenancy_id','property_id','room_id','reference','pending']) ||
   jsonb_build_object('invoice_reference',left(md5(i->>'id'),10))) from jsonb_array_elements(item->'invoices') i)) item,
 row_number() over(partition by item->>'stage' order by item->>'key') n
 from result
)
select jsonb_build_object(
 'company_id',(select company_id from params),'as_of',(select as_of from params),'report_date',(select report_date from params),
 'source_version','20261027051603_rental_collection_review.sql',
 'communications_enabled',false,'reason','Review only; consent, WhatsApp ownership, STOP handling and compliance approval are not activated.',
 'summary',jsonb_build_object('groups',(select count(*) from result),
  'tenants',(select count(*) from result where item->>'tenant_id' is not null),
  'unlinked_records',(select count(*) from result where item->>'tenant_id' is null),
  'phone_valid',(select count(*) from result where (item->>'phone_valid')::boolean),
  'protected_recipient',(select count(*) from result where (item->>'protected_recipient')::boolean),
  'whatsapp_ownership_verified',(select count(*) from result where (item->>'whatsapp_ownership_verified')::boolean),
  'send_eligible',(select count(*) from result where (item->>'send_eligible')::boolean)),
 'stages',(select jsonb_agg(to_jsonb(stage_counts) order by stage) from stage_counts),
 'exceptions',(select jsonb_agg(to_jsonb(exception_counts) order by code) from exception_counts),
 'delivery_blocks',(select jsonb_agg(to_jsonb(block_counts) order by code) from block_counts),
 'samples',(select jsonb_agg(item order by item->>'stage',item->>'reference') from redacted where n<=2),
 'items',(select jsonb_agg(item order by item->>'stage',item->>'reference') from redacted)
) result;
