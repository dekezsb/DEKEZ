-- REVIEW ONLY. Additive collection communications ledger, not accounting or enforcement.
-- No schedules, provider calls, existing-policy changes, source writes or consent inference.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create role dekez_collection_executor nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant dekez_collection_executor to current_user with inherit false, set true;
create schema dekez_collections_private;
revoke all on schema dekez_collections_private from public,anon,authenticated,service_role;
grant usage on schema dekez_collections_private to service_role,dekez_collection_executor;
grant create on schema dekez_collections_private to dekez_collection_executor;

create table dekez_collections_private.controls (
 company_id uuid primary key references public.companies(id),
 enabled boolean not null default false,
 compliance_approved boolean not null default false,
 opt_out_ready boolean not null default false,
 approved_by uuid references public.profiles(id),
 approved_at timestamptz,
 review_reference text check(length(review_reference) between 10 and 500),
 check(not compliance_approved or (approved_by is not null and approved_at is not null and review_reference is not null))
);
create table dekez_collections_private.contact_controls (
 company_id uuid not null references public.companies(id),
 tenant_id uuid not null references public.profiles(id),
 consent text not null default 'unknown' check(consent in ('unknown','opted_in','opted_out')),
 consent_reference text check(length(consent_reference) between 10 and 500),
 approved_recipient text check(approved_recipient ~ '^[1-9][0-9]{8,14}$'),
 hold text not null default 'none' check(hold in ('none','dispute','legal','communications','manual')),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 primary key(company_id,tenant_id),
 check(consent<>'opted_in' or (consent_reference is not null and approved_recipient is not null and reviewed_by is not null and reviewed_at is not null))
);
create table dekez_collections_private.daily_cases (
 company_id uuid not null references public.companies(id),
 tenant_key text not null check(length(tenant_key) between 1 and 80),
 report_date date not null,
 tenant_id uuid references public.profiles(id),
 stage text not null,
 outstanding numeric(14,2),
 snapshot jsonb not null,
 first_checked_at timestamptz not null default clock_timestamp(),
 last_checked_at timestamptz not null default clock_timestamp(),
 primary key(company_id,tenant_key,report_date)
);
create table dekez_collections_private.escalations (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 tenant_key text not null,
 invoice_id uuid not null references public.rent_bills(id),
 threshold integer not null check(threshold in (7,14)),
 original_due_date date not null,
 detected_on date not null,
 snapshot jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 unique(company_id,invoice_id,threshold)
);
create table dekez_collections_private.attempts (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 tenant_id uuid not null references public.profiles(id),
 tenant_key text not null,
 report_date date not null,
 recipient text not null check(recipient ~ '^[1-9][0-9]{8,14}$'),
 snapshot jsonb not null,
 message_body text not null check(length(message_body) between 1 and 4000),
 state text not null default 'sending' check(state in ('sending','accepted','rejected','uncertain')),
 provider_message_id text check(provider_message_id ~ '^[A-Za-z0-9._-]{1,200}$'),
 http_status integer check(http_status between 100 and 599),
 error_code text check(error_code in ('provider_rejected','delivery_uncertain','worker_interrupted')),
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 unique(company_id,tenant_id,report_date),
 unique(recipient,report_date),
 check(state<>'accepted' or (provider_message_id is not null and http_status between 200 and 299 and error_code is null)),
 check((state='sending')=(finished_at is null))
);
create index collection_cases_day on dekez_collections_private.daily_cases(company_id,report_date,tenant_key);
create index collection_attempts_recent on dekez_collections_private.attempts(company_id,created_at desc);
create table dekez_collections_private.audit (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 action text not null check(action in ('case_checked','review_escalated','delivery_claimed','delivery_finished')),
 record_id text not null,
 recorded_at timestamptz not null default clock_timestamp(),
 details jsonb not null default '{}'
);
-- No direct runtime table access. Even BYPASSRLS service_role lacks table grants.
do $security$ declare t text; begin
 foreach t in array array['controls','contact_controls','daily_cases','escalations','attempts','audit'] loop
  execute format('alter table dekez_collections_private.%I enable row level security',t);
  execute format('alter table dekez_collections_private.%I force row level security',t);
  execute format('revoke all on dekez_collections_private.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on dekez_collections_private.%I to dekez_collection_executor',t);
  execute format('create policy collection_read on dekez_collections_private.%I for select to dekez_collection_executor using(true)',t);
 end loop;
 foreach t in array array['daily_cases','escalations','attempts','audit'] loop
  execute format('grant insert on dekez_collections_private.%I to dekez_collection_executor',t);
  execute format('create policy collection_insert on dekez_collections_private.%I for insert to dekez_collection_executor with check(true)',t);
 end loop;
 foreach t in array array['daily_cases','attempts'] loop
  execute format('grant update on dekez_collections_private.%I to dekez_collection_executor',t);
  execute format('create policy collection_update on dekez_collections_private.%I for update to dekez_collection_executor using(true) with check(true)',t);
 end loop;
end $security$;

create function dekez_collections_private.policy(p_company uuid,p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=on as $$
declare c dekez_collections_private.controls; t dekez_collections_private.contact_controls;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 select * into c from dekez_collections_private.controls where company_id=p_company;
 select * into t from dekez_collections_private.contact_controls where company_id=p_company and tenant_id=p_tenant;
 return jsonb_build_object('enabled',coalesce(c.enabled,false),'compliance_approved',coalesce(c.compliance_approved,false),
  'opt_out_ready',coalesce(c.opt_out_ready,false),'approved_recipient',t.approved_recipient,
  'consent',coalesce(t.consent,'unknown'),'hold',coalesce(t.hold,'none'));
end $$;

-- Source-only projection. SECURITY INVOKER retains the existing server's source
-- permissions; the private executor receives NO access to business tables.
create function public.dekez_collection_source(p_company uuid,p_as_of timestamptz) returns setof jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='20s' as $$
declare d date:=(p_as_of at time zone 'Asia/Kuala_Lumpur')::date;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 if p_as_of is null or not isfinite(p_as_of) or not exists(select 1 from public.companies where id=p_company) then raise exception 'Invalid collection scope'; end if;
 return query
 -- SOURCE_PREVIEW_BEGIN: the review SQL fixture extracts this read-only CTE.
 with profile_phones as materialized (
  select id,case when regexp_replace(coalesce(phone,''),'[[:space:]().+-]','','g') ~ '^01[0-9]{8,9}$'
   then '60'||substr(regexp_replace(phone,'[[:space:]().+-]','','g'),2)
   else regexp_replace(coalesce(phone,''),'[[:space:]().+-]','','g') end phone from public.profiles
 ), source as materialized (
  select b.id,b.tenancy_id,b.tenant_id as bill_profile,b.tenant_record_id,b.property_id,b.room_id,b.invoice_number,b.due_date,
   b.amount base_amount,coalesce(li.total,0) extra_amount,b.paid_amount,b.status::text bill_status,b.tenant_facing,b.issued_at,b.invoice_date,b.bill_month,
   case when b.amount is not null and b.paid_amount is not null
    and b.amount::text not in ('NaN','Infinity','-Infinity') and b.paid_amount::text not in ('NaN','Infinity','-Infinity')
    and coalesce(li.total,0)::text not in ('NaN','Infinity','-Infinity') then greatest(b.amount+coalesce(li.total,0)-b.paid_amount,0) end outstanding,
   coalesce(person.profile_id,legacy_person.profile_id,b.tenant_id) tenant_id,
   coalesce(person.profile_id,legacy_person.profile_id,b.tenant_id)::text person_key,
   coalesce(p.full_name,person.full_name,legacy_person.full_name,'Unlinked tenant') tenant_name,
   p.phone profile_phone,person.phone tenant_phone,p.role::text profile_role,p.registration_status,
   tn.company_id tenancy_company,tn.status::text tenancy_status,tn.billing_status,tn.checkout_date,
   tn.property_id tenancy_property,tn.room_id tenancy_room,person.profile_id tenancy_profile,
   prop.name property_name,prop.property_code,coalesce(room.room_number,room.name) room_name,
   coalesce(pay.verified,0) verified_paid,coalesce(pay.unallocated_credit,0) unallocated_credit,
   coalesce(pay.bad_scope,false) payment_scope_conflict,coalesce(pay.bad_submission,false) payment_submission_conflict,
   coalesce(pending.rows,'[]'::jsonb) pending,
   coalesce(pending.n,0)>0 or b.status::text in ('payment_submitted','pending_verification','submitted') pending_verification
  from public.rent_bills b join public.properties prop on prop.id=b.property_id and prop.company_id=p_company
  left join public.rooms room on room.id=b.room_id and room.property_id=b.property_id
  left join public.tenancies tn on tn.id=b.tenancy_id
  left join public.tenants person on person.id=tn.tenant_id
  left join public.tenant_records legacy on legacy.id=b.tenant_record_id
  left join public.tenants legacy_person on legacy_person.id=legacy.tenant_id
  left join public.profiles p on p.id=coalesce(person.profile_id,legacy_person.profile_id,b.tenant_id)
  left join lateral(select sum(i.amount) total from public.rental_invoice_line_items i where i.rent_bill_id=b.id) li on true
  left join lateral(
   select sum(v.amount) filter(where v.category in ('monthly_rent','key_lock','electricity','water','access_card','damage','cleaning','furniture','other','top_up_utilities')) verified,
    sum(v.amount) filter(where v.category='payment_credit') unallocated_credit,
    bool_or(v.company_id is distinct from p_company or v.tenancy_id is distinct from b.tenancy_id or v.property_id is distinct from b.property_id or v.room_id is distinct from b.room_id) bad_scope,
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
  select s.*,coalesce(person_key,'invoice:'||id::text) tenant_key,d-due_date days_overdue,
   case when regexp_replace(coalesce(profile_phone,''),'[[:space:]().+-]','','g') ~ '^01[0-9]{8,9}$'
    then '60'||substr(regexp_replace(profile_phone,'[[:space:]().+-]','','g'),2)
    else regexp_replace(coalesce(profile_phone,''),'[[:space:]().+-]','','g') end phone,
   array_remove(array[
    case when tenant_id is null or tenancy_id is null or tenancy_profile is distinct from tenant_id or bill_profile is distinct from tenant_id
     or tenancy_company is distinct from p_company or tenancy_property is distinct from property_id or tenancy_room is distinct from room_id
     or profile_role is distinct from 'tenant' or registration_status is distinct from 'approved' then 'identity_or_scope' end,
    case when tenancy_status is distinct from 'active' or checkout_date is not null or billing_status is distinct from 'active' then 'inactive_or_checked_out' end,
    case when tenant_facing is distinct from true then 'internal_invoice' end,
    case when bill_status in ('draft','cancelled','waived') then 'non_collectible_invoice_state' end,
    case when regexp_replace(coalesce(tenant_phone,''),'[[:space:]().+-]','','g') not in
      (regexp_replace(coalesce(profile_phone,''),'[[:space:]().+-]','','g'),
       '0'||substr(regexp_replace(coalesce(profile_phone,''),'[[:space:]().+-]','','g'),3),
       '60'||substr(regexp_replace(coalesce(profile_phone,''),'[[:space:]().+-]','','g'),2)) then 'contact_phone_mismatch' end,
    case when issued_at is null or issued_at>p_as_of or coalesce(invoice_date,bill_month)>d then 'invoice_not_issued' end,
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
  select c.*,invoice_exceptions <@ array['contact_phone_mismatch'] financially_collectible from checked c
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
  select g.*,dekez_collections_private.policy(p_company,tenant_id) policy,
   exceptions || case when phone !~ '^[1-9][0-9]{8,14}$' then '["invalid_phone"]'::jsonb else '[]'::jsonb end
    || case when phone<>'' and exists(select 1 from profile_phones other where other.id is distinct from g.tenant_id and other.phone=g.phone)
       then '["shared_phone"]'::jsonb else '[]'::jsonb end
    || case when exists(select 1 from public.whatsapp_conversations w where w.normalized_phone=g.phone and w.status='blocked')
       then '["blocked_contact"]'::jsonb else '[]'::jsonb end
    || case when exists(select 1 from public.rent_reminder_logs old where old.channel='whatsapp' and old.tenant_id=g.tenant_id
       and (old.sent_at at time zone 'Asia/Kuala_Lumpur')::date=d) then '["legacy_message_today"]'::jsonb else '[]'::jsonb end all_exceptions,
   case when outstanding is null then 'exception'
    when outstanding<=0.005 then case when jsonb_array_length(exceptions)=0 and not pending_verification then 'resolved' else 'exception' end
    when collectible_outstanding<=0.005 then 'exception'
    when days_overdue is null then 'exception' when days_overdue>=15 then 'overdue_15_plus'
    when days_overdue=14 then 'day_14_review' when days_overdue>=8 then 'overdue_8_13'
    when days_overdue=7 then 'day_7_review' when days_overdue>=1 then 'overdue_1_6'
    when days_overdue=0 then 'due_today' when advance_due then 'advance_7' else 'tracking' end stage
  from grouped g
 ), result as (
  select jsonb_build_object('company_id',p_company,'report_date',d,'key',tenant_key,'tenant_id',tenant_id,
   'name',tenant_name,'phone',phone,'stage',stage,'days_overdue',days_overdue,'outstanding',outstanding,
   'recorded_days_overdue',recorded_days_overdue,'collectible_outstanding',collectible_outstanding,
   'recorded_arrears_outstanding',recorded_arrears_outstanding,
   'arrears_outstanding',arrears_outstanding,
   'arrears_resolved',arrears_outstanding<=0.005 and jsonb_array_length(exceptions)=0 and not pending_verification,
   'partial_invoices',partial_invoices,'invoices',invoices,'pending',pending,'pending_verification',pending_verification,
   'exceptions',all_exceptions,'policy',policy,
   'send_eligible',stage not in ('tracking','resolved','exception') and outstanding>0.005 and not pending_verification and jsonb_array_length(all_exceptions)=0
    and policy->>'consent'='opted_in' and policy->>'approved_recipient'=phone and policy->>'hold'='none'
    and (policy->>'enabled')::boolean and (policy->>'compliance_approved')::boolean and (policy->>'opt_out_ready')::boolean,
   'resolved',outstanding<=0.005 and jsonb_array_length(exceptions)=0 and not pending_verification) item
  from guarded
 ) select item||jsonb_build_object('fingerprint',md5(item::text)) from result;
 -- SOURCE_PREVIEW_END
end $$;

create function public.dekez_collection_preview(p_company uuid,p_as_of timestamptz,p_after text default null,p_limit integer default 50) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='20s' as $$
declare result jsonb;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid page size'; end if;
 with all_rows as materialized(select s item from public.dekez_collection_source(p_company,p_as_of) s),
 page as(select item from all_rows where p_after is null or item->>'key'>p_after order by item->>'key' limit p_limit),
 stages as(select item->>'stage' stage,count(*) groups,count(*) filter(where item->>'tenant_id' is not null) tenants,
  count(*) filter(where item->>'tenant_id' is null) unlinked_records,
  sum((item->>'collectible_outstanding')::numeric) amount,sum((item->>'outstanding')::numeric) recorded_amount,
  count(*) filter(where (item->>'partial_invoices')::int>0 and item->>'tenant_id' is not null) partial_tenants,
  count(*) filter(where (item->>'send_eligible')::boolean) send_eligible
  from all_rows group by item->>'stage'),
 exceptions as(select e code,count(distinct item->>'tenant_id') tenants,
  count(distinct item->>'key') filter(where item->>'tenant_id' is null) unlinked_records
  from all_rows cross join lateral jsonb_array_elements_text(item->'exceptions') e group by e)
 select jsonb_build_object('company_id',p_company,'report_date',(p_as_of at time zone 'Asia/Kuala_Lumpur')::date,'as_of',p_as_of,
  'items',coalesce((select jsonb_agg(item order by item->>'key') from page),'[]'::jsonb),
  'next_cursor',case when (select count(*) from page)=p_limit then (select max(item->>'key') from page) end,
  'summary',jsonb_build_object('groups',(select count(*) from all_rows),
   'tenants',(select count(*) from all_rows where item->>'tenant_id' is not null),
   'unlinked_records',(select count(*) from all_rows where item->>'tenant_id' is null),
   'stages',coalesce((select jsonb_agg(to_jsonb(stages) order by stage) from stages),'[]'::jsonb),
   'exceptions',coalesce((select jsonb_agg(to_jsonb(exceptions) order by code) from exceptions),'[]'::jsonb),
   'pending_verification',(select count(*) from all_rows where (item->>'pending_verification')::boolean))) into result;
 return result;
end $$;

create function dekez_collections_private.track(p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare c uuid:=(p_snapshot->>'company_id')::uuid; k text:=p_snapshot->>'key'; d date:=(p_snapshot->>'report_date')::date; i jsonb; n int; new_reviews int:=0; day7 int:=0; day14 int:=0; previous_snapshot jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if d is distinct from (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date or k is null then raise exception 'Invalid collection snapshot'; end if;
 perform pg_advisory_xact_lock(hashtextextended('collection-case:'||c::text||':'||k,0));
 select snapshot into previous_snapshot from dekez_collections_private.daily_cases where company_id=c and tenant_key=k and report_date=d;
 insert into dekez_collections_private.daily_cases(company_id,tenant_key,report_date,tenant_id,stage,outstanding,snapshot)
 values(c,k,d,(p_snapshot->>'tenant_id')::uuid,p_snapshot->>'stage',(p_snapshot->>'outstanding')::numeric,p_snapshot)
 on conflict(company_id,tenant_key,report_date) do update set stage=excluded.stage,outstanding=excluded.outstanding,snapshot=excluded.snapshot,last_checked_at=clock_timestamp();
 for i in select value from jsonb_array_elements(p_snapshot->'invoices') loop
  -- Threshold review is internal even while payment proof/dispute/consent blocks messaging.
  -- Partial payment never changes original due date, threshold or review history.
  for n in select v from (values(7),(14)) t(v) where (i->>'days_overdue')::int>=v and (i->>'outstanding')::numeric>0.005
   and coalesce((i->>'collectible')::boolean,false) loop
   insert into dekez_collections_private.escalations(company_id,tenant_key,invoice_id,threshold,original_due_date,detected_on,snapshot)
    values(c,k,(i->>'id')::uuid,n,(i->>'due_date')::date,d,i)
    on conflict(company_id,invoice_id,threshold) do nothing;
   if found then new_reviews:=new_reviews+1;
    if n=7 then day7:=day7+1; else day14:=day14+1; end if;
    insert into dekez_collections_private.audit(company_id,action,record_id,details)
     values(c,'review_escalated',i->>'id',jsonb_build_object('threshold',n,'internal_review_only',true));
   end if;
  end loop;
 end loop;
 if previous_snapshot is distinct from p_snapshot then
  insert into dekez_collections_private.audit(company_id,action,record_id,details)
   values(c,'case_checked',k,jsonb_build_object('report_date',d,'previous',previous_snapshot,'current',p_snapshot));
 end if;
 return p_snapshot||jsonb_build_object('new_reviews',new_reviews,'new_day_7',day7,'new_day_14',day14);
end $$;

create function public.dekez_collection_track(p_company uuid,p_key text) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' as $$
declare s jsonb;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 select x into s from public.dekez_collection_source(p_company,clock_timestamp()) x where x->>'key'=p_key;
 if s is null then return jsonb_build_object('state','not_found'); end if;
 return dekez_collections_private.track(s);
end $$;

-- Materialize the source once, then track every scoped row in one transaction.
-- Failure/timeout rolls the entire scan back; no partial success is reported.
create function public.dekez_collection_scan(p_company uuid) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='25s' set lock_timeout='5s' as $$
declare s jsonb; r jsonb; d date:=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
 checked int:=0; day7 int:=0; day14 int:=0; exceptions int:=0;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 for s in with snapshots as materialized(select x from public.dekez_collection_source(p_company,clock_timestamp()) x)
   select x from snapshots order by x->>'key' loop
  r:=dekez_collections_private.track(s); checked:=checked+1;
  day7:=day7+(r->>'new_day_7')::int; day14:=day14+(r->>'new_day_14')::int;
  if jsonb_array_length(s->'exceptions')>0 or (s->>'pending_verification')::boolean then exceptions:=exceptions+1; end if;
 end loop;
 return jsonb_build_object('report_date',d,'checked',checked,'urgent_day7',day7,'urgent_day14',day14,'exceptions',exceptions);
end $$;

create function dekez_collections_private.claim(p_snapshot jsonb,p_body text) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare a dekez_collections_private.attempts; c uuid:=(p_snapshot->>'company_id')::uuid;
 t uuid:=(p_snapshot->>'tenant_id')::uuid; d date:=(p_snapshot->>'report_date')::date; pol jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if d is distinct from (clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date or t is null
  or p_body is null or length(p_body) not between 1 and 4000 then raise exception 'Invalid collection delivery'; end if;
 -- Pending proof is always referred to Admin in this first release. No arbitrary
 -- caller-provided demand can be disguised as the neutral verification template.
 if coalesce((p_snapshot->>'pending_verification')::boolean,false) then return jsonb_build_object('claimed',false,'state','pending_review'); end if;
 perform pg_advisory_xact_lock(hashtextextended('dekez-collection:'||(p_snapshot->>'phone'),0));
 pol:=dekez_collections_private.policy(c,t);
 if not coalesce((p_snapshot->>'send_eligible')::boolean,false) or not (pol->>'enabled')::boolean
  or not (pol->>'compliance_approved')::boolean or not (pol->>'opt_out_ready')::boolean
  or pol->>'approved_recipient' is distinct from p_snapshot->>'phone' or pol->>'consent'<>'opted_in' or pol->>'hold'<>'none'
  then return jsonb_build_object('claimed',false,'state','withheld'); end if;
 -- Permanent claims: rejection, crash and unknown provider outcome never reopen this date.
 insert into dekez_collections_private.attempts(company_id,tenant_id,tenant_key,report_date,recipient,snapshot,message_body)
 values(c,t,p_snapshot->>'key',d,p_snapshot->>'phone',p_snapshot,p_body)
 on conflict do nothing returning * into a;
 if a.id is null then return jsonb_build_object('claimed',false,'state','duplicate'); end if;
 insert into dekez_collections_private.audit(company_id,action,record_id) values(c,'delivery_claimed',a.id::text);
 return jsonb_build_object('claimed',true,'attempt_id',a.id,'recipient',a.recipient,'body',a.message_body,'state','sending');
end $$;

create function public.dekez_collection_claim(p_company uuid,p_key text,p_fingerprint text,p_body text) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='20s' set lock_timeout='5s' as $$
declare s jsonb; before_lock jsonb; at_time timestamptz;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 if p_key is null or length(p_key) not between 1 and 80 then raise exception 'Invalid collection key'; end if;
 perform pg_advisory_xact_lock(hashtextextended('collection-case:'||p_company::text||':'||p_key,0));
 select x into before_lock from public.dekez_collection_source(p_company,clock_timestamp()) x where x->>'key'=p_key;
 if before_lock is null then return jsonb_build_object('claimed',false,'state','not_found'); end if;
 perform pg_advisory_xact_lock(hashtextextended('dekez-collection:'||(before_lock->>'phone'),0));
 at_time:=clock_timestamp();
 if extract(hour from at_time at time zone 'Asia/Kuala_Lumpur')<>9 then return jsonb_build_object('claimed',false,'state','outside_window'); end if;
 -- A fresh READ COMMITTED statement after lock waits observes any committed
 -- settlement/consent changes. Caller-provided balances are never accepted.
 select x into s from public.dekez_collection_source(p_company,at_time) x where x->>'key'=p_key;
 if s is null then return jsonb_build_object('claimed',false,'state','not_found'); end if;
 if s->>'phone' is distinct from before_lock->>'phone' then return jsonb_build_object('claimed',false,'state','source_changed'); end if;
 if s->>'fingerprint' is distinct from p_fingerprint then return jsonb_build_object('claimed',false,'state','source_changed'); end if;
 -- Any outgoing text that says a case was referred must have its review record
 -- persisted atomically first, even if a caller did not invoke the daily scan.
 perform dekez_collections_private.track(s);
 return dekez_collections_private.claim(s,p_body);
end $$;

create function dekez_collections_private.finish(p_attempt uuid,p_state text,p_provider_id text,p_http_status integer,p_error text) returns void
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare a dekez_collections_private.attempts;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_state is null or p_state not in ('accepted','rejected','uncertain')
  or (p_state='accepted' and (p_provider_id is null or p_provider_id !~ '^[A-Za-z0-9._-]{1,200}$' or p_http_status is null or p_http_status not between 200 and 299 or p_error is not null))
  or (p_state='rejected' and p_error is distinct from 'provider_rejected')
  or (p_state='uncertain' and (p_error is null or p_error not in ('delivery_uncertain','worker_interrupted'))) then raise exception 'Invalid collection outcome'; end if;
 select * into a from dekez_collections_private.attempts where id=p_attempt for update;
 if a.id is null then raise exception 'Unknown delivery'; end if;
 if a.state=p_state and a.provider_message_id is not distinct from p_provider_id and a.http_status is not distinct from p_http_status and a.error_code is not distinct from p_error then return; end if;
 if a.state<>'sending' then raise exception 'Delivery already finalized'; end if;
 update dekez_collections_private.attempts set state=p_state,provider_message_id=p_provider_id,http_status=p_http_status,error_code=p_error,finished_at=clock_timestamp() where id=a.id;
 insert into dekez_collections_private.audit(company_id,action,record_id,details) values(a.company_id,'delivery_finished',a.id::text,jsonb_build_object('state',p_state));
end $$;
create function public.dekez_collection_finish(p_attempt uuid,p_state text,p_provider_id text default null,p_http_status integer default null,p_error text default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 perform dekez_collections_private.finish(p_attempt,p_state,p_provider_id,p_http_status,p_error);
end $$;

create function dekez_collections_private.history(p_company uuid,p_day date,p_after text,p_limit int) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=on as $$
declare result jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid page size'; end if;
 with rows as(select c.tenant_key,c.stage,c.outstanding,c.last_checked_at,c.snapshot,
  (select jsonb_build_object('state',a.state,'provider_message_id',a.provider_message_id,'created_at',a.created_at,'finished_at',a.finished_at,'error_code',a.error_code)
   from dekez_collections_private.attempts a where a.company_id=c.company_id and a.tenant_key=c.tenant_key and a.report_date=c.report_date) delivery
  from dekez_collections_private.daily_cases c where c.company_id=p_company and c.report_date=p_day and (p_after is null or c.tenant_key>p_after)
  order by c.tenant_key limit p_limit)
 select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(rows) order by tenant_key),'[]'::jsonb),
  'next_cursor',case when count(*)=p_limit then max(tenant_key) end,
  'new_day_7_reviews',(select count(*) from dekez_collections_private.escalations e where e.company_id=p_company and e.detected_on=p_day and e.threshold=7),
  'new_day_14_reviews',(select count(*) from dekez_collections_private.escalations e where e.company_id=p_company and e.detected_on=p_day and e.threshold=14)) into result from rows;
 return result;
end $$;
create function public.dekez_collection_history(p_company uuid,p_day date,p_after text default null,p_limit int default 50) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 if not exists(select 1 from public.companies where id=p_company) then raise exception 'Invalid collection scope'; end if;
 return dekez_collections_private.history(p_company,p_day,p_after,p_limit);
end $$;

-- Explicit, new-function-only grants. No existing table/function policy changes.
do $grants$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='dekez_collections_private' loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
  execute format('alter function %s owner to dekez_collection_executor',f.signature);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('dekez_collection_source','dekez_collection_preview','dekez_collection_track','dekez_collection_scan','dekez_collection_claim','dekez_collection_finish','dekez_collection_history') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $grants$;
revoke create on schema dekez_collections_private from dekez_collection_executor;
grant dekez_collection_executor to current_user with inherit false, set false;
commit;
