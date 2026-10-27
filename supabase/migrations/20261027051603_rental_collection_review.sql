-- REVIEW ONLY. Additive rental payment reminder ledger, not accounting or enforcement.
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
 legacy_handover_complete boolean not null default false,
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
 -- Evidence bindings only: neither field is ever a routing override.
 -- Portal login/PIN approval alone is not proof of WhatsApp ownership or consent.
 ownership_recipient text check(ownership_recipient ~ '^[1-9][0-9]{8,14}$'),
 ownership_reference text check(length(ownership_reference) between 10 and 500),
 ownership_verified_by uuid references public.profiles(id),
 ownership_verified_at timestamptz,
 hold text not null default 'none' check(hold in ('none','dispute','legal','communications','manual')),
 reviewed_by uuid references public.profiles(id),
 reviewed_at timestamptz,
 primary key(company_id,tenant_id),
 check(consent<>'opted_in' or (consent_reference is not null and approved_recipient is not null and reviewed_by is not null and reviewed_at is not null))
 ,check((ownership_recipient is null and ownership_reference is null and ownership_verified_by is null and ownership_verified_at is null)
  or (ownership_recipient is not null and ownership_reference is not null and ownership_verified_by is not null and ownership_verified_at is not null))
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
 recipient text not null check(recipient ~ '^[1-9][0-9]{8,14}$' and recipient not in ('60198894911','60168173911','60188702371')),
 snapshot jsonb not null,
 message_body text not null check(length(message_body) between 1 and 4000),
 state text not null default 'sending' check(state in ('sending','accepted','rejected','uncertain')),
 provider_message_id text check(provider_message_id ~ '^[A-Za-z0-9._-]{1,200}$'),
 http_status integer check(http_status between 100 and 599),
 error_code text check(error_code in ('provider_rejected','delivery_uncertain','worker_interrupted')),
 delivery_state text not null default 'unconfirmed' check(delivery_state in ('unconfirmed','sent','delivered','read','failed','unknown','conflict')),
 delivery_updated_at timestamptz,
 followup_resolved_at timestamptz,
 followup_resolved_by uuid references public.profiles(id),
 followup_resolution_state text,
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 unique(company_id,tenant_id,report_date),
 unique(recipient,report_date),
 check(state<>'accepted' or (provider_message_id is not null and http_status between 200 and 299 and error_code is null)),
 check((state='sending')=(finished_at is null))
);
create index collection_cases_day on dekez_collections_private.daily_cases(company_id,report_date,tenant_key);
create index collection_attempts_recent on dekez_collections_private.attempts(company_id,created_at desc);
create unique index collection_attempt_provider on dekez_collections_private.attempts(provider_message_id) where provider_message_id is not null;
-- Provider metadata only: never store incoming text, tokens or authentication headers.
create table dekez_collections_private.provider_events (
 channel text not null check(channel='FALCON-D9NS9'),
 event_id text not null check(event_id ~ '^[A-Za-z0-9._:-]{1,200}$'),
 company_id uuid not null references public.companies(id),
 provider_message_id text not null check(provider_message_id ~ '^[A-Za-z0-9._-]{1,200}$'),
 recipient text not null check(recipient ~ '^[1-9][0-9]{8,14}$'),
 kind text not null check(kind in ('stop','start','sent','delivered','read','failed','unknown')),
 occurred_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(),
 primary key(channel,event_id)
);
create index collection_events_message on dekez_collections_private.provider_events(company_id,provider_message_id,recipient,occurred_at);
-- STOP is number-bound, not tenant-bound: ambiguous/unlinked numbers are still suppressed.
create table dekez_collections_private.number_suppressions (
 channel text not null check(channel='FALCON-D9NS9'),
 recipient text not null check(recipient ~ '^[1-9][0-9]{8,14}$'),
 company_id uuid not null references public.companies(id),
 suppressed boolean not null default true,
 last_event_id text,
 changed_at timestamptz not null default clock_timestamp(),
 primary key(channel,recipient)
);
create table dekez_collections_private.failure_report_controls (
 company_id uuid primary key references public.companies(id),
 recipient text not null default '60188702371' check(recipient='60188702371'),
 recipient_profile uuid not null references public.profiles(id),
 ownership_reference text check(length(ownership_reference) between 10 and 500),
 ownership_verified_by uuid references public.profiles(id),
 ownership_verified_at timestamptz,
 consent text not null default 'unknown' check(consent in ('unknown','opted_in','opted_out')),
 consent_reference text check(length(consent_reference) between 10 and 500),
 reviewed_by uuid not null references public.profiles(id),
 reviewed_at timestamptz not null default clock_timestamp(),
 check(consent<>'opted_in' or (consent_reference is not null and ownership_reference is not null and ownership_verified_by is not null and ownership_verified_at is not null))
);
create table dekez_collections_private.failure_reports (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 report_date date not null,
 recipient text not null check(recipient='60188702371'),
 fingerprint text not null,
 snapshot jsonb not null,
 message_body text not null check(length(message_body) between 1 and 4000),
 latest_snapshot jsonb not null,
 state text not null default 'sending' check(state in ('sending','accepted','rejected','uncertain')),
 provider_message_id text check(provider_message_id ~ '^[A-Za-z0-9._-]{1,200}$'),
 http_status integer check(http_status between 100 and 599),
 error_code text check(error_code in ('provider_rejected','delivery_uncertain','worker_interrupted')),
 created_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz,
 unique(company_id,report_date,recipient),
 unique(recipient,report_date),
 check(state<>'accepted' or (provider_message_id is not null and http_status between 200 and 299 and error_code is null)),
 check((state='sending')=(finished_at is null))
);
create table dekez_collections_private.worker_runs (
 company_id uuid not null references public.companies(id),
 report_date date not null,
 lease_token uuid not null default gen_random_uuid(),
 expires_at timestamptz not null default statement_timestamp()+interval '300 seconds',
 state text not null default 'running' check(state in ('running','complete','incomplete','failed')),
 started_at timestamptz not null default statement_timestamp(),
 finished_at timestamptz,
 outcome jsonb,
 primary key(company_id,report_date),
 unique(lease_token),
 check(expires_at>started_at and expires_at<=started_at+interval '300 seconds'),
 check((state='running')=(finished_at is null))
);
create table dekez_collections_private.audit (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 action text not null check(action in ('case_checked','review_escalated','delivery_claimed','delivery_finished','contact_reviewed','contact_event','delivery_receipt','failure_recipient_reviewed','failure_report_claimed','failure_report_finished','failure_report_draft_updated','worker_started','worker_finished','followup_resolved')),
 record_id text not null,
 recorded_at timestamptz not null default clock_timestamp(),
 details jsonb not null default '{}'
);
-- No direct runtime table access. Even BYPASSRLS service_role lacks table grants.
do $security$ declare t text; begin
 foreach t in array array['controls','contact_controls','daily_cases','escalations','attempts','audit','provider_events','number_suppressions','failure_report_controls','failure_reports','worker_runs'] loop
  execute format('alter table dekez_collections_private.%I enable row level security',t);
  execute format('alter table dekez_collections_private.%I force row level security',t);
  execute format('revoke all on dekez_collections_private.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on dekez_collections_private.%I to dekez_collection_executor',t);
  execute format('create policy collection_read on dekez_collections_private.%I for select to dekez_collection_executor using(true)',t);
 end loop;
 foreach t in array array['contact_controls','daily_cases','escalations','attempts','audit','provider_events','number_suppressions','failure_report_controls','failure_reports','worker_runs'] loop
  execute format('grant insert on dekez_collections_private.%I to dekez_collection_executor',t);
  execute format('create policy collection_insert on dekez_collections_private.%I for insert to dekez_collection_executor with check(true)',t);
 end loop;
 foreach t in array array['contact_controls','daily_cases','attempts','number_suppressions','failure_report_controls','failure_reports','worker_runs'] loop
  execute format('grant update on dekez_collections_private.%I to dekez_collection_executor',t);
  execute format('create policy collection_update on dekez_collections_private.%I for update to dekez_collection_executor using(true) with check(true)',t);
 end loop;
end $security$;

create function dekez_collections_private.number_suppressed(p_recipient text) returns boolean
language plpgsql stable security definer set search_path='' set row_security=on as $$
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 return exists(select 1 from dekez_collections_private.number_suppressions
  where channel='FALCON-D9NS9' and recipient=p_recipient and suppressed);
end $$;

create function dekez_collections_private.policy(p_company uuid,p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=on as $$
declare c dekez_collections_private.controls; t dekez_collections_private.contact_controls;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 select * into c from dekez_collections_private.controls where company_id=p_company;
 select * into t from dekez_collections_private.contact_controls where company_id=p_company and tenant_id=p_tenant;
 return jsonb_build_object('enabled',coalesce(c.enabled,false),'compliance_approved',coalesce(c.compliance_approved,false),
  'opt_out_ready',coalesce(c.opt_out_ready,false),'legacy_handover_complete',coalesce(c.legacy_handover_complete,false),'approved_recipient',t.approved_recipient,
  'ownership_recipient',t.ownership_recipient,
  'ownership_verified',coalesce(t.ownership_recipient is not null and t.ownership_reference is not null
   and t.ownership_verified_by is not null and t.ownership_verified_at<=clock_timestamp(),false),
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
  from public.rent_bills b join public.properties prop on prop.id=b.property_id and prop.company_id=p_company
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
   portal_phone phone,
   array_remove(array[
    case when tenant_id is null or tenancy_id is null or tenancy_profile is distinct from tenant_id or bill_profile is distinct from tenant_id
     or tenancy_company is distinct from p_company or tenancy_property is distinct from property_id or tenancy_room is distinct from room_id
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
    case when policy->>'consent'='opted_out' or dekez_collections_private.number_suppressed(phone) then 'opted_out' when policy->>'consent'<>'opted_in' then 'consent_missing' end,
    case when policy->>'consent'='opted_in' and policy->>'approved_recipient' is distinct from phone then 'consent_number_mismatch' end,
    case when not coalesce((policy->>'ownership_verified')::boolean and policy->>'ownership_recipient'=phone,false) then 'whatsapp_ownership_unverified' end,
    case when policy->>'hold'<>'none' then 'contact_hold' end,
    case when not (policy->>'enabled')::boolean then 'collection_disabled' end,
    case when not (policy->>'compliance_approved')::boolean then 'compliance_approval_missing' end,
    case when not (policy->>'opt_out_ready')::boolean then 'opt_out_not_ready' end,
    case when not (policy->>'legacy_handover_complete')::boolean then 'legacy_handover_incomplete' end
   ],null)) delivery_blocks
  from guarded g
 ), result as (
  select jsonb_build_object('company_id',p_company,'report_date',d,'key',tenant_key,'tenant_id',tenant_id,
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
  from all_rows cross join lateral jsonb_array_elements_text(item->'exceptions') e group by e),
 delivery_blocks as(select e code,count(*) groups,count(distinct item->>'tenant_id') tenants,
  count(distinct item->>'key') filter(where item->>'tenant_id' is null) unlinked_records
  from all_rows cross join lateral jsonb_array_elements_text(item->'delivery_blocks') e group by e)
 select jsonb_build_object('company_id',p_company,'report_date',(p_as_of at time zone 'Asia/Kuala_Lumpur')::date,'as_of',p_as_of,
  'items',coalesce((select jsonb_agg(item order by item->>'key') from page),'[]'::jsonb),
  'next_cursor',case when (select count(*) from page)=p_limit then (select max(item->>'key') from page) end,
  'summary',jsonb_build_object('groups',(select count(*) from all_rows),
   'tenants',(select count(*) from all_rows where item->>'tenant_id' is not null),
   'unlinked_records',(select count(*) from all_rows where item->>'tenant_id' is null),
   'stages',coalesce((select jsonb_agg(to_jsonb(stages) order by stage) from stages),'[]'::jsonb),
   'exceptions',coalesce((select jsonb_agg(to_jsonb(exceptions) order by code) from exceptions),'[]'::jsonb),
   'delivery_blocks',coalesce((select jsonb_agg(to_jsonb(delivery_blocks) order by code) from delivery_blocks),'[]'::jsonb),
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
 if p_snapshot->>'phone' in ('60198894911','60168173911','60188702371') then return jsonb_build_object('claimed',false,'state','protected_recipient'); end if;
 -- Pending proof is always referred to Admin in this first release. No arbitrary
 -- caller-provided demand can be disguised as the neutral verification template.
 if coalesce((p_snapshot->>'pending_verification')::boolean,false) then return jsonb_build_object('claimed',false,'state','pending_review'); end if;
 perform pg_advisory_xact_lock(hashtextextended('dekez-collection:'||(p_snapshot->>'phone'),0));
 if dekez_collections_private.number_suppressed(p_snapshot->>'phone') then return jsonb_build_object('claimed',false,'state','opted_out'); end if;
 pol:=dekez_collections_private.policy(c,t);
 if not coalesce((p_snapshot->>'send_eligible')::boolean,false) or not (pol->>'enabled')::boolean
  or not (pol->>'compliance_approved')::boolean or not (pol->>'opt_out_ready')::boolean
  or not (pol->>'legacy_handover_complete')::boolean
  or not coalesce((pol->>'ownership_verified')::boolean,false) or pol->>'ownership_recipient' is distinct from p_snapshot->>'phone'
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
 if not dekez_collections_private.worker_active(p_company) then return jsonb_build_object('claimed',false,'state','worker_not_active'); end if;
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
 if not dekez_collections_private.worker_active(p_company) then return jsonb_build_object('claimed',false,'state','worker_expired'); end if;
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
 if p_provider_id is not null then perform pg_advisory_xact_lock(hashtextextended('dekez-receipt:'||p_provider_id,0)); end if;
 select * into a from dekez_collections_private.attempts where id=p_attempt for update;
 if a.id is null then raise exception 'Unknown delivery'; end if;
 if a.state=p_state and a.provider_message_id is not distinct from p_provider_id and a.http_status is not distinct from p_http_status and a.error_code is not distinct from p_error then return; end if;
 if a.state<>'sending' then raise exception 'Delivery already finalized'; end if;
 update dekez_collections_private.attempts set state=p_state,provider_message_id=p_provider_id,http_status=p_http_status,error_code=p_error,finished_at=clock_timestamp() where id=a.id;
 insert into dekez_collections_private.audit(company_id,action,record_id,details) values(a.company_id,'delivery_finished',a.id::text,jsonb_build_object('state',p_state));
 -- A callback can arrive before the HTTP response is finalized. Reconcile
 -- already-recorded exact-ID/recipient receipts without another provider send.
 if p_provider_id is not null then perform dekez_collections_private.apply_receipts(a.id); end if;
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
  (select jsonb_build_object('state',a.state,'provider_message_id',a.provider_message_id,'created_at',a.created_at,'finished_at',a.finished_at,'error_code',a.error_code,'delivery_state',a.delivery_state,'delivery_updated_at',a.delivery_updated_at)
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

-- Fresh operational Admin checks use the existing profile, company membership
-- and module ceiling. No metadata claims, global user directory or source writes.
create function public.dekez_collection_assert_admin(p_company uuid,p_actor uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare r text;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 select role::text into r from public.profiles where id=p_actor and registration_status='approved';
 if r is null or r not in ('admin','super_admin') or not exists(
  select 1 from public.company_users m where m.company_id=p_company and coalesce(m.user_id,m.profile_id)=p_actor
   and (m.user_id is null or m.profile_id is null or m.user_id=m.profile_id)
   and m.status::text='active' and m.role::text in ('admin','super_admin')) then raise insufficient_privilege using message='Authorized payment reminder administrator required'; end if;
 -- Super Admin matches the existing application ceiling. Admin defaults to
 -- manage for this operational module; an explicit view/none always restricts it.
 if r='admin' and exists(select 1 from public.user_module_permissions where profile_id=p_actor
  and module_key='rent_due_tracker' and access_level::text is distinct from 'manage') then raise insufficient_privilege; end if;
end $$;

create function dekez_collections_private.review_contact(p_company uuid,p_tenant uuid,p_recipient text,p_actor uuid,p_action text,p_reference text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare previous dekez_collections_private.contact_controls; current_row dekez_collections_private.contact_controls;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_actor is null or p_recipient is null or p_recipient !~ '^[1-9][0-9]{8,14}$'
  or p_recipient in ('60198894911','60168173911','60188702371')
  or p_reference is null or length(btrim(p_reference)) not between 10 and 500
  or p_reason is null or length(btrim(p_reason)) not between 10 and 500
  or p_action is null or p_action not in ('verify_ownership','record_opt_in','record_opt_out','set_dispute_hold','set_manual_hold','clear_hold','review_resubscription') then raise exception 'Invalid payment reminder evidence review'; end if;
 perform pg_advisory_xact_lock(hashtextextended('dekez-collection:'||p_recipient,0));
 select * into previous from dekez_collections_private.contact_controls where company_id=p_company and tenant_id=p_tenant for update;
 if p_action in ('record_opt_in','review_resubscription') and (previous.ownership_recipient is distinct from p_recipient
  or previous.ownership_reference is null or previous.ownership_verified_by is null
  or previous.ownership_verified_at is null or previous.ownership_verified_at>clock_timestamp()) then raise exception 'Verified current-number ownership evidence required'; end if;
 if p_action='record_opt_in' and dekez_collections_private.number_suppressed(p_recipient) then raise exception 'Explicit resubscription evidence review required'; end if;
 if p_action='clear_hold' and previous.hold in ('legal','communications') then raise exception 'Restricted communication hold requires separate authorized review'; end if;
 if p_action='review_resubscription' and exists(select 1 from dekez_collections_private.number_suppressions
  where channel='FALCON-D9NS9' and recipient=p_recipient and company_id<>p_company) then raise insufficient_privilege; end if;
 insert into dekez_collections_private.contact_controls(company_id,tenant_id,reviewed_by,reviewed_at)
 values(p_company,p_tenant,p_actor,clock_timestamp()) on conflict(company_id,tenant_id) do nothing;
 if p_action='verify_ownership' then
  update dekez_collections_private.contact_controls set ownership_recipient=p_recipient,ownership_reference=btrim(p_reference),
   ownership_verified_by=p_actor,ownership_verified_at=clock_timestamp(),
   consent=case when approved_recipient is distinct from p_recipient then 'unknown' else consent end
   where company_id=p_company and tenant_id=p_tenant;
 elsif p_action in ('record_opt_in','review_resubscription') then
  update dekez_collections_private.contact_controls set consent='opted_in',approved_recipient=p_recipient,consent_reference=btrim(p_reference),
   reviewed_by=p_actor,reviewed_at=clock_timestamp() where company_id=p_company and tenant_id=p_tenant;
  if p_action='review_resubscription' then update dekez_collections_private.number_suppressions set suppressed=false,changed_at=clock_timestamp()
   where channel='FALCON-D9NS9' and recipient=p_recipient and company_id=p_company; end if;
 elsif p_action='record_opt_out' then
  update dekez_collections_private.contact_controls set consent='opted_out',approved_recipient=p_recipient,consent_reference=btrim(p_reference)
   where company_id=p_company and tenant_id=p_tenant;
  insert into dekez_collections_private.number_suppressions(channel,recipient,company_id,suppressed)
  values('FALCON-D9NS9',p_recipient,p_company,true) on conflict(channel,recipient) do update set suppressed=true,changed_at=clock_timestamp();
 else
  update dekez_collections_private.contact_controls set hold=case p_action when 'set_dispute_hold' then 'dispute' when 'set_manual_hold' then 'manual' else 'none' end
   where company_id=p_company and tenant_id=p_tenant;
 end if;
 update dekez_collections_private.contact_controls set reviewed_by=p_actor,reviewed_at=clock_timestamp()
  where company_id=p_company and tenant_id=p_tenant returning * into current_row;
 insert into dekez_collections_private.audit(company_id,action,record_id,details) values(p_company,'contact_reviewed',p_tenant::text,
  jsonb_build_object('actor',p_actor,'action',p_action,'reason',btrim(p_reason),'reference',btrim(p_reference),'before',to_jsonb(previous),'after',to_jsonb(current_row)));
 return jsonb_build_object('state','reviewed','tenant_id',p_tenant,'masked_recipient','***'||right(p_recipient,4),
  'consent',current_row.consent,'ownership_verified',current_row.ownership_recipient=p_recipient and current_row.ownership_verified_at is not null,
  'hold',current_row.hold,'suppressed',dekez_collections_private.number_suppressed(p_recipient));
end $$;

create function public.dekez_collection_review_contact(p_company uuid,p_tenant uuid,p_recipient text,p_actor uuid,p_action text,p_reference text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare login_phone text;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 perform pg_advisory_xact_lock(hashtextextended('collection-case:'||p_company::text||':'||p_tenant::text,0));
 perform pg_advisory_xact_lock(hashtextextended('dekez-collection:'||p_recipient,0));
 -- Recheck after waiting; a revoked Admin or changed tenant phone cannot use a
 -- stale form. Recipient is an equality assertion, never a routing override.
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 select case when raw.digits ~ '^01[0-9]{8,9}$' then '60'||substr(raw.digits,2)
  when raw.digits ~ '^[1-9][0-9]{8,14}$' then raw.digits end into login_phone
 from public.profiles p cross join lateral(select regexp_replace(btrim(coalesce(p.phone,'')),'[[:space:]().-]','','g') compact) cleaned
 cross join lateral(select case when cleaned.compact like '+%' then substr(cleaned.compact,2) else cleaned.compact end digits) raw
 where p.id=p_tenant and p.role::text='tenant' and p.registration_status='approved'
  and exists(select 1 from public.tenants t join public.tenancies tn on tn.tenant_id=t.id
   join public.rooms r on r.id=tn.room_id and r.current_tenancy_id=tn.id and r.property_id=tn.property_id
   join public.properties pr on pr.id=tn.property_id and pr.company_id=p_company
   where t.profile_id=p.id and tn.company_id=p_company and tn.status::text='active'
    and tn.billing_status='active' and tn.checkout_date is null);
 if login_phone is null or login_phone is distinct from p_recipient then raise exception 'Current tenant login number and active tenancy required'; end if;
 if not exists(select 1 from public.profiles p where p.id=p_tenant and p.normalized_phone in (login_phone,'0'||substr(login_phone,3))) then raise exception 'Portal login lookup mismatch requires review'; end if;
 if exists(select 1 from public.profiles p where p.id<>p_tenant and regexp_replace(coalesce(p.phone,''),'[[:space:]().+-]','','g')
  in (login_phone,'0'||substr(login_phone,3))) then raise exception 'Ambiguous login number requires identity review'; end if;
 return dekez_collections_private.review_contact(p_company,p_tenant,login_phone,p_actor,p_action,p_reference,p_reason);
end $$;

create function dekez_collections_private.ingest_contact_event(p_company uuid,p_channel text,p_event_id text,p_provider_message_id text,p_recipient text,p_kind text,p_occurred_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare inserted text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_channel is distinct from 'FALCON-D9NS9' or p_kind is null or p_kind not in ('stop','start')
  or p_recipient is null or p_recipient !~ '^[1-9][0-9]{8,14}$' or p_event_id is null or p_event_id !~ '^[A-Za-z0-9._:-]{1,200}$'
  or p_provider_message_id is null or p_provider_message_id !~ '^[A-Za-z0-9._-]{1,200}$'
  or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>clock_timestamp()+interval '5 minutes' then raise exception 'Invalid authenticated contact event'; end if;
 perform pg_advisory_xact_lock(hashtextextended('dekez-collection:'||p_recipient,0));
 insert into dekez_collections_private.provider_events(channel,event_id,company_id,provider_message_id,recipient,kind,occurred_at)
 values(p_channel,p_event_id,p_company,p_provider_message_id,p_recipient,p_kind,p_occurred_at)
 on conflict(channel,event_id) do nothing returning event_id into inserted;
 if inserted is null then
  if exists(select 1 from dekez_collections_private.provider_events where channel=p_channel and event_id=p_event_id
   and (company_id is distinct from p_company or provider_message_id is distinct from p_provider_message_id or recipient is distinct from p_recipient or kind is distinct from p_kind)) then
   raise exception 'Conflicting provider event identity';
  end if;
  return jsonb_build_object('state','duplicate');
 end if;
 if p_kind='stop' then
  insert into dekez_collections_private.number_suppressions(channel,recipient,company_id,suppressed,last_event_id)
  values(p_channel,p_recipient,p_company,true,p_event_id)
  on conflict(channel,recipient) do update set suppressed=true,last_event_id=p_event_id,changed_at=clock_timestamp();
 end if;
 insert into dekez_collections_private.audit(company_id,action,record_id,details) values(p_company,'contact_event',p_event_id,
  jsonb_build_object('kind',p_kind,'recipient',p_recipient,'provider_message_id',p_provider_message_id,'occurred_at',p_occurred_at));
 return jsonb_build_object('state',case when p_kind='stop' then 'suppressed' else 'start_review_required' end);
end $$;
create function public.dekez_collection_ingest_contact_event(p_company uuid,p_channel text,p_event_id text,p_provider_message_id text,p_recipient text,p_kind text,p_occurred_at timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 if not exists(select 1 from public.companies where id=p_company) then raise exception 'Invalid reminder company'; end if;
 return dekez_collections_private.ingest_contact_event(p_company,p_channel,p_event_id,p_provider_message_id,p_recipient,p_kind,p_occurred_at);
end $$;

-- Recompute from immutable receipts, so event arrival order cannot turn an
-- accepted request into a false delivery confirmation or an automatic retry.
create function dekez_collections_private.apply_receipts(p_attempt uuid) returns text
language plpgsql security definer set search_path='' set row_security=on as $$
declare a dekez_collections_private.attempts; result text; has_failure boolean; has_delivery boolean; has_read boolean; has_sent boolean; has_unknown boolean;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 select * into a from dekez_collections_private.attempts where id=p_attempt for update;
 if a.id is null then return 'unmatched'; end if;
 select coalesce(bool_or(kind='failed'),false),coalesce(bool_or(kind in ('delivered','read')),false),coalesce(bool_or(kind='read'),false),
  coalesce(bool_or(kind='sent'),false),coalesce(bool_or(kind='unknown'),false)
 into has_failure,has_delivery,has_read,has_sent,has_unknown
 from dekez_collections_private.provider_events where channel='FALCON-D9NS9' and company_id=a.company_id
  and provider_message_id=a.provider_message_id and recipient=a.recipient
  and occurred_at>=a.created_at-interval '5 minutes' and kind not in ('stop','start');
 result:=case when has_failure and has_delivery then 'conflict' when has_read then 'read' when has_delivery then 'delivered'
  when has_failure then 'failed' when has_sent then 'sent' when has_unknown then 'unknown' else 'unconfirmed' end;
 if result is distinct from a.delivery_state then
  update dekez_collections_private.attempts set delivery_state=result,delivery_updated_at=clock_timestamp() where id=a.id;
  insert into dekez_collections_private.audit(company_id,action,record_id,details) values(a.company_id,'delivery_receipt',a.id::text,
   jsonb_build_object('previous',a.delivery_state,'current',result));
 end if;
 return result;
end $$;
create function dekez_collections_private.ingest_receipt(p_company uuid,p_channel text,p_event_id text,p_provider_message_id text,p_recipient text,p_status text,p_occurred_at timestamptz) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare inserted text; attempt uuid; result text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_channel is distinct from 'FALCON-D9NS9' or p_status is null or p_status not in ('sent','delivered','read','failed','unknown')
  or p_recipient is null or p_recipient !~ '^[1-9][0-9]{8,14}$' or p_event_id is null or p_event_id !~ '^[A-Za-z0-9._:-]{1,200}$'
  or p_provider_message_id is null or p_provider_message_id !~ '^[A-Za-z0-9._-]{1,200}$'
  or p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>clock_timestamp()+interval '5 minutes' then raise exception 'Invalid authenticated delivery event'; end if;
 -- The provider ID is a durable transport identifier, not a tenant-supplied ID.
 perform pg_advisory_xact_lock(hashtextextended('dekez-receipt:'||p_provider_message_id,0));
 insert into dekez_collections_private.provider_events(channel,event_id,company_id,provider_message_id,recipient,kind,occurred_at)
 values(p_channel,p_event_id,p_company,p_provider_message_id,p_recipient,p_status,p_occurred_at)
 on conflict(channel,event_id) do nothing returning event_id into inserted;
 if inserted is null then
  if exists(select 1 from dekez_collections_private.provider_events where channel=p_channel and event_id=p_event_id
   and (company_id is distinct from p_company or provider_message_id is distinct from p_provider_message_id or recipient is distinct from p_recipient or kind is distinct from p_status)) then
   raise exception 'Conflicting provider event identity';
  end if;
  return jsonb_build_object('state','duplicate');
 end if;
 select id into attempt from dekez_collections_private.attempts where company_id=p_company and provider_message_id=p_provider_message_id and recipient=p_recipient;
 if attempt is null then return jsonb_build_object('state','unmatched','delivery_state','unconfirmed'); end if;
 result:=dekez_collections_private.apply_receipts(attempt);
 return jsonb_build_object('state','recorded','delivery_state',result);
end $$;
create function public.dekez_collection_ingest_receipt(p_company uuid,p_channel text,p_event_id text,p_provider_message_id text,p_recipient text,p_status text,p_occurred_at timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 if not exists(select 1 from public.companies where id=p_company) then raise exception 'Invalid reminder company'; end if;
 return dekez_collections_private.ingest_receipt(p_company,p_channel,p_event_id,p_provider_message_id,p_recipient,p_status,p_occurred_at);
end $$;

-- A single bounded worker per company/local date. Expiry NEVER authorizes an
-- automatic replacement worker after an uncertain or interrupted batch.
create function dekez_collections_private.worker_active(p_company uuid) returns boolean
language plpgsql stable security definer set search_path='' set row_security=on as $$
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 return exists(select 1 from dekez_collections_private.worker_runs where company_id=p_company
  and report_date=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date and state='running' and expires_at>clock_timestamp());
end $$;
create function dekez_collections_private.begin_run(p_company uuid) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare c dekez_collections_private.controls; r dekez_collections_private.worker_runs; issued timestamptz;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended('reminder-worker:'||p_company::text,0));
 issued:=clock_timestamp();
 if extract(hour from issued at time zone 'Asia/Kuala_Lumpur')<>9 then return jsonb_build_object('claimed',false,'state','outside_window'); end if;
 select * into c from dekez_collections_private.controls where company_id=p_company;
 if not coalesce(c.enabled and c.compliance_approved and c.opt_out_ready and c.legacy_handover_complete,false) then return jsonb_build_object('claimed',false,'state','disabled'); end if;
 insert into dekez_collections_private.worker_runs(company_id,report_date,started_at,expires_at)
 values(p_company,(issued at time zone 'Asia/Kuala_Lumpur')::date,issued,issued+interval '300 seconds')
 on conflict(company_id,report_date) do nothing returning * into r;
 if r.lease_token is null then return jsonb_build_object('claimed',false,'state','already_started'); end if;
 insert into dekez_collections_private.audit(company_id,action,record_id) values(p_company,'worker_started',r.report_date::text);
 return jsonb_build_object('claimed',true,'state','running','run_id',r.lease_token,'expires_at',r.expires_at);
end $$;
create function public.dekez_collection_begin_run(p_company uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 if not exists(select 1 from public.companies where id=p_company) then raise exception 'Invalid reminder company'; end if;
 return dekez_collections_private.begin_run(p_company);
end $$;
create function dekez_collections_private.finish_run(p_run uuid,p_state text) returns void
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare r dekez_collections_private.worker_runs;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_state is null or p_state not in ('complete','incomplete','failed') then raise exception 'Invalid worker outcome'; end if;
 select * into r from dekez_collections_private.worker_runs where lease_token=p_run for update;
 if r.lease_token is null then raise exception 'Unknown worker reservation'; end if;
 if r.state=p_state then return; end if;
 if r.state<>'running' then raise exception 'Worker already finalized'; end if;
 update dekez_collections_private.worker_runs set state=p_state,finished_at=clock_timestamp() where lease_token=p_run;
 insert into dekez_collections_private.audit(company_id,action,record_id,details) values(r.company_id,'worker_finished',r.report_date::text,jsonb_build_object('state',p_state));
end $$;
create function public.dekez_collection_finish_run(p_run uuid,p_state text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 perform dekez_collections_private.finish_run(p_run,p_state);
end $$;

create function dekez_collections_private.failure_policy(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=on as $$
declare c dekez_collections_private.failure_report_controls;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 select * into c from dekez_collections_private.failure_report_controls where company_id=p_company;
 return jsonb_build_object('recipient_profile',c.recipient_profile,'consent',coalesce(c.consent,'unknown'),
  'ownership_verified',coalesce(c.ownership_reference is not null and c.ownership_verified_by is not null and c.ownership_verified_at<=clock_timestamp(),false),
  'suppressed',dekez_collections_private.number_suppressed('60188702371'));
end $$;
create function public.dekez_collection_failure_recipient(p_company uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare ids uuid[]; manager_id uuid; approved boolean:=false; member boolean:=false; manager boolean:=false; pol jsonb;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 if not exists(select 1 from public.companies where id=p_company) then raise exception 'Invalid reminder company'; end if;
 select array_agg(p.id order by p.id) into ids from public.profiles p
  cross join lateral(select regexp_replace(btrim(coalesce(p.phone,'')),'[[:space:]().-]','','g') compact) cleaned
  where cleaned.compact in ('60188702371','+60188702371','0188702371') and p.normalized_phone in ('60188702371','0188702371');
 if cardinality(ids)=1 then
  manager_id:=ids[1];
  select registration_status='approved' and role::text in ('admin','super_admin') into approved from public.profiles where id=manager_id;
  select exists(select 1 from public.company_users m where m.company_id=p_company and coalesce(m.user_id,m.profile_id)=manager_id
   and (m.user_id is null or m.profile_id is null or m.user_id=m.profile_id)
   and m.status::text='active' and m.role::text in ('admin','super_admin')) into member;
  begin perform public.dekez_collection_assert_admin(p_company,manager_id); manager:=true;
  exception when insufficient_privilege then manager:=false; end;
 end if;
 pol:=dekez_collections_private.failure_policy(p_company);
 return jsonb_build_object('verified',coalesce(approved and member and manager,false),'company_id',p_company,'recipient','60188702371',
  'management_profile_id',coalesce(manager_id::text,''),'approved_management_account',coalesce(approved,false),'active_company_membership',member,
  'rent_due_tracker_manage',manager,'whatsapp_ownership_verified',coalesce((pol->>'ownership_verified')::boolean and pol->>'recipient_profile'=manager_id::text,false),
  'whatsapp_consent',case when (pol->>'suppressed')::boolean then 'opted_out' when pol->>'recipient_profile'=manager_id::text then pol->>'consent' else 'unknown' end);
end $$;
create function dekez_collections_private.review_failure_recipient(p_company uuid,p_actor uuid,p_recipient_profile uuid,p_action text,p_reference text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare before_row dekez_collections_private.failure_report_controls; after_row dekez_collections_private.failure_report_controls;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_action is null or p_action not in ('verify_ownership','record_opt_in','record_opt_out') or p_reference is null or length(btrim(p_reference)) not between 10 and 500
  or p_reason is null or length(btrim(p_reason)) not between 10 and 500 then raise exception 'Invalid management recipient evidence'; end if;
 perform pg_advisory_xact_lock(hashtextextended('dekez-collection:60188702371',0));
 select * into before_row from dekez_collections_private.failure_report_controls where company_id=p_company for update;
 if p_action='record_opt_in' and (before_row.recipient_profile is distinct from p_recipient_profile or before_row.ownership_reference is null
  or before_row.ownership_verified_by is null or before_row.ownership_verified_at is null or before_row.ownership_verified_at>clock_timestamp()
  or dekez_collections_private.number_suppressed('60188702371')) then raise exception 'Current ownership and unsuppressed consent review required'; end if;
 insert into dekez_collections_private.failure_report_controls(company_id,recipient_profile,reviewed_by)
 values(p_company,p_recipient_profile,p_actor) on conflict(company_id) do nothing;
 if p_action='verify_ownership' then
  update dekez_collections_private.failure_report_controls set recipient_profile=p_recipient_profile,ownership_reference=btrim(p_reference),
   ownership_verified_by=p_actor,ownership_verified_at=clock_timestamp(),
   consent=case when recipient_profile is distinct from p_recipient_profile then 'unknown' else consent end where company_id=p_company;
 else
  update dekez_collections_private.failure_report_controls set consent=case when p_action='record_opt_in' then 'opted_in' else 'opted_out' end,
   consent_reference=btrim(p_reference) where company_id=p_company;
  if p_action='record_opt_out' then
   insert into dekez_collections_private.number_suppressions(channel,recipient,company_id,suppressed)
   values('FALCON-D9NS9','60188702371',p_company,true) on conflict(channel,recipient) do update set suppressed=true,changed_at=clock_timestamp();
  end if;
 end if;
 update dekez_collections_private.failure_report_controls set reviewed_by=p_actor,reviewed_at=clock_timestamp()
  where company_id=p_company returning * into after_row;
 insert into dekez_collections_private.audit(company_id,action,record_id,details) values(p_company,'failure_recipient_reviewed',p_recipient_profile::text,
  jsonb_build_object('actor',p_actor,'action',p_action,'reference',btrim(p_reference),'reason',btrim(p_reason),'before',to_jsonb(before_row),'after',to_jsonb(after_row)));
 return jsonb_build_object('state','reviewed','recipient','60188702371','consent',after_row.consent);
end $$;
create function public.dekez_collection_review_failure_recipient(p_company uuid,p_actor uuid,p_recipient_profile uuid,p_action text,p_reference text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
declare a jsonb;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 perform pg_advisory_xact_lock(hashtextextended('dekez-collection:60188702371',0));
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 a:=public.dekez_collection_failure_recipient(p_company);
 if not (a->>'verified')::boolean or a->>'management_profile_id' is distinct from p_recipient_profile::text then raise insufficient_privilege using message='Current authorized management recipient required'; end if;
 return dekez_collections_private.review_failure_recipient(p_company,p_actor,p_recipient_profile,p_action,p_reference,p_reason);
end $$;

create function dekez_collections_private.failure_evidence(p_company uuid,p_after text,p_limit integer) returns jsonb
language plpgsql stable security definer set search_path='' set row_security=on as $$
declare result jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid evidence page size'; end if;
 with latest as(select distinct on (tenant_key) * from dekez_collections_private.daily_cases where company_id=p_company order by tenant_key,report_date desc,last_checked_at desc),
 all_rows as materialized(
  select 'attempt:'||a.id::text key,'attempt' kind,jsonb_build_object('attempt_id',a.id,'company_id',a.company_id,'tenant_id',a.tenant_id,
   'state',case when a.delivery_state='failed' then 'failed' when a.delivery_state in ('unknown','conflict') then 'unknown' else a.state end,
   'confirmed_failure',a.delivery_state='failed','confirmation',case when a.delivery_state='failed' then 'provider_delivery_receipt' else 'none' end,
   'failure_code',case when a.delivery_state='failed' then 'delivery_failed' when a.state='rejected' then 'provider_rejected' else null end,
   'provider_message_id',a.provider_message_id,'resolved_at',null) data
  from dekez_collections_private.attempts a where a.company_id=p_company and a.delivery_state not in ('delivered','read')
   and (a.followup_resolved_at is null or a.followup_resolution_state is distinct from a.state||':'||a.delivery_state)
  union all
  select 'case:'||c.tenant_key,'case',jsonb_build_object('case_id',c.tenant_key||':'||c.report_date::text,'company_id',c.company_id,
   'tenant_id',c.tenant_id,'tenant_key',c.tenant_key,'category',case when jsonb_array_length(c.snapshot->'exceptions')>0 then 'source_exception' else 'communications_hold' end,
   'reason_code',coalesce(c.snapshot->'exceptions'->>0,c.snapshot->'delivery_blocks'->>0,'source_exception'),'resolved_at',null)
  from latest c where not coalesce((c.snapshot->>'resolved')::boolean,false)
   and (jsonb_array_length(c.snapshot->'exceptions')>0 or jsonb_array_length(c.snapshot->'delivery_blocks')>0)
 ), page as(select * from all_rows where p_after is null or key>p_after order by key limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(page) order by key) from page),'[]'::jsonb),
  'next_cursor',case when (select count(*) from page)=p_limit then (select max(key) from page) end,
  'total',(select count(*) from all_rows),'evidence_hash',md5(coalesce((select jsonb_agg(to_jsonb(all_rows) order by key)::text from all_rows),'[]')),
  'daily_reservation',coalesce((select case when state='accepted' then 'sent' else 'reserved' end from dekez_collections_private.failure_reports
   where company_id=p_company and report_date=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date),'not_reserved')) into result;
 return result;
end $$;
create function public.dekez_collection_failure_evidence(p_company uuid,p_after text default null,p_limit integer default 100) returns jsonb
language plpgsql stable security invoker set search_path='' set statement_timeout='25s' as $$
declare a jsonb; history jsonb; source_hash text; d date:=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 a:=public.dekez_collection_failure_recipient(p_company);
 history:=dekez_collections_private.failure_evidence(p_company,p_after,p_limit);
 select md5(coalesce(jsonb_agg(s order by s->>'key')::text,'[]')) into source_hash from public.dekez_collection_source(p_company,clock_timestamp()) s;
 return (history-'evidence_hash')||jsonb_build_object('report_date',d,'recipient_authorization',a,
  'fingerprint',md5(p_company::text||d::text||source_hash||(history->>'evidence_hash')||a::text));
end $$;

create function dekez_collections_private.failure_claim(p_company uuid,p_fingerprint text,p_body text,p_snapshot jsonb,p_authorization jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare r dekez_collections_private.failure_reports; c dekez_collections_private.controls; pol jsonb;
 d date:=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date; generic_body text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{32}$' or p_body is null or length(p_body) not between 1 and 4000
  or p_snapshot is null or p_snapshot->>'company_id' is distinct from p_company::text or p_snapshot->>'report_date' is distinct from d::text
  or p_snapshot->>'recipient' is distinct from '60188702371' or p_snapshot->>'all_history_loaded' is distinct from 'true' then raise exception 'Invalid consolidated report snapshot'; end if;
 perform pg_advisory_xact_lock(hashtextextended('failure-report:'||p_company::text||':'||d::text,0));
 perform pg_advisory_xact_lock(hashtextextended('dekez-collection:60188702371',0));
 select * into r from dekez_collections_private.failure_reports where company_id=p_company and report_date=d;
 if r.id is not null then
  if r.latest_snapshot is distinct from p_snapshot then
   update dekez_collections_private.failure_reports set latest_snapshot=p_snapshot where id=r.id;
   insert into dekez_collections_private.audit(company_id,action,record_id) values(p_company,'failure_report_draft_updated',r.id::text);
  end if;
  return jsonb_build_object('claimed',false,'state','already_reserved');
 end if;
 select * into c from dekez_collections_private.controls where company_id=p_company;
 pol:=dekez_collections_private.failure_policy(p_company);
 if not exists(select 1 from dekez_collections_private.worker_runs where company_id=p_company and report_date=d
  and (state<>'running' or expires_at<=clock_timestamp())) then return jsonb_build_object('claimed',false,'state','daily_review_incomplete'); end if;
 if not coalesce(c.enabled and c.compliance_approved and c.opt_out_ready and c.legacy_handover_complete,false)
  or not (pol->>'ownership_verified')::boolean or pol->>'consent'<>'opted_in' or (pol->>'suppressed')::boolean
  or p_authorization->>'management_profile_id' is distinct from pol->>'recipient_profile'
  or p_authorization->>'whatsapp_ownership_verified' is distinct from 'true' or p_authorization->>'whatsapp_consent' is distinct from 'opted_in'
  then return jsonb_build_object('claimed',false,'state','withheld'); end if;
 if not coalesce((p_authorization->>'verified')::boolean,false) then
  generic_body:='DEKEZ MANAGEMENT'||chr(10)||'LAPORAN SUSULAN PERINGATAN PEMBAYARAN WHATSAPP'||chr(10)||'Tarikh: '||d::text||' (Malaysia)'||chr(10)||chr(10)||
   'Semakan susulan tersedia melalui Portal Admin yang selamat. Maklumat penyewa tidak disertakan. Akses memerlukan kebenaran akaun pengurusan.'||chr(10)||'https://dekez.vercel.app/';
  if p_body is distinct from generic_body or p_snapshot->>'contains_personal_details' is distinct from 'false' then raise insufficient_privilege using message='Only generic management portal notice authorized'; end if;
 end if;
 insert into dekez_collections_private.failure_reports(company_id,report_date,recipient,fingerprint,snapshot,message_body,latest_snapshot)
 values(p_company,d,'60188702371',p_fingerprint,p_snapshot,p_body,p_snapshot) on conflict do nothing returning * into r;
 if r.id is null then return jsonb_build_object('claimed',false,'state','already_reserved'); end if;
 insert into dekez_collections_private.audit(company_id,action,record_id) values(p_company,'failure_report_claimed',r.id::text);
 return jsonb_build_object('claimed',true,'state','sending','attempt_id',r.id,'recipient',r.recipient,'body',r.message_body);
end $$;
create function public.dekez_collection_failure_claim(p_company uuid,p_fingerprint text,p_body text,p_snapshot jsonb) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='30s' set lock_timeout='5s' as $$
declare evidence jsonb; d date;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 d:=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date;
 if extract(hour from clock_timestamp() at time zone 'Asia/Kuala_Lumpur')<9 then return jsonb_build_object('claimed',false,'state','before_daily_review'); end if;
 perform pg_advisory_xact_lock(hashtextextended('failure-report:'||p_company::text||':'||d::text,0));
 perform pg_advisory_xact_lock(hashtextextended('dekez-collection:60188702371',0));
 evidence:=public.dekez_collection_failure_evidence(p_company,null,1);
 if evidence->>'fingerprint' is distinct from p_fingerprint then return jsonb_build_object('claimed',false,'state','source_changed'); end if;
 return dekez_collections_private.failure_claim(p_company,p_fingerprint,p_body,p_snapshot,evidence->'recipient_authorization');
end $$;
create function dekez_collections_private.failure_finish(p_attempt uuid,p_state text,p_provider_id text,p_http_status integer,p_error text) returns void
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare r dekez_collections_private.failure_reports;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_state is null or p_state not in ('accepted','rejected','uncertain')
  or (p_state='accepted' and (p_provider_id is null or p_provider_id !~ '^[A-Za-z0-9._-]{1,200}$' or p_http_status is null or p_http_status not between 200 and 299 or p_error is not null))
  or (p_state='rejected' and p_error is distinct from 'provider_rejected')
  or (p_state='uncertain' and (p_error is null or p_error not in ('delivery_uncertain','worker_interrupted'))) then raise exception 'Invalid consolidated report outcome'; end if;
 select * into r from dekez_collections_private.failure_reports where id=p_attempt for update;
 if r.id is null then raise exception 'Unknown consolidated report'; end if;
 if r.state=p_state and r.provider_message_id is not distinct from p_provider_id and r.http_status is not distinct from p_http_status and r.error_code is not distinct from p_error then return; end if;
 if r.state<>'sending' then raise exception 'Consolidated report already finalized'; end if;
 update dekez_collections_private.failure_reports set state=p_state,provider_message_id=p_provider_id,http_status=p_http_status,error_code=p_error,finished_at=clock_timestamp() where id=r.id;
 insert into dekez_collections_private.audit(company_id,action,record_id,details) values(r.company_id,'failure_report_finished',r.id::text,jsonb_build_object('state',p_state));
end $$;
create function public.dekez_collection_failure_finish(p_attempt uuid,p_state text,p_provider_id text default null,p_http_status integer default null,p_error text default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 perform dekez_collections_private.failure_finish(p_attempt,p_state,p_provider_id,p_http_status,p_error);
end $$;

create function dekez_collections_private.resolve_followup(p_company uuid,p_actor uuid,p_attempt uuid,p_reference text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare a dekez_collections_private.attempts;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_actor is null or p_reference is null or length(btrim(p_reference)) not between 10 and 500
  or p_reason is null or length(btrim(p_reason)) not between 10 and 500 then raise exception 'Documented follow-up review required'; end if;
 select * into a from dekez_collections_private.attempts where id=p_attempt and company_id=p_company for update;
 if a.id is null then raise insufficient_privilege using message='Authorized delivery follow-up required'; end if;
 if a.followup_resolved_at is not null and a.followup_resolution_state=a.state||':'||a.delivery_state then return jsonb_build_object('state','already_resolved','attempt_id',a.id); end if;
 update dekez_collections_private.attempts set followup_resolved_at=clock_timestamp(),followup_resolved_by=p_actor,
  followup_resolution_state=a.state||':'||a.delivery_state where id=a.id;
 insert into dekez_collections_private.audit(company_id,action,record_id,details) values(p_company,'followup_resolved',a.id::text,
  jsonb_build_object('actor',p_actor,'reference',btrim(p_reference),'reason',btrim(p_reason),'transport_state',a.state,'delivery_state',a.delivery_state));
 -- Only the follow-up task is resolved: no delivery claim, financial write,
 -- consent grant or retry release. Later changed provider evidence resurfaces.
 return jsonb_build_object('state','resolved','attempt_id',a.id);
end $$;
create function public.dekez_collection_resolve_followup(p_company uuid,p_actor uuid,p_attempt uuid,p_reference text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 perform pg_advisory_xact_lock(hashtextextended('reminder-followup:'||p_attempt::text,0));
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 return dekez_collections_private.resolve_followup(p_company,p_actor,p_attempt,p_reference,p_reason);
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
  where n.nspname='public' and p.proname in ('dekez_collection_source','dekez_collection_preview','dekez_collection_track','dekez_collection_scan','dekez_collection_claim','dekez_collection_finish','dekez_collection_history','dekez_collection_assert_admin','dekez_collection_review_contact','dekez_collection_ingest_contact_event','dekez_collection_ingest_receipt','dekez_collection_begin_run','dekez_collection_finish_run','dekez_collection_failure_recipient','dekez_collection_review_failure_recipient','dekez_collection_failure_evidence','dekez_collection_failure_claim','dekez_collection_failure_finish','dekez_collection_resolve_followup') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $grants$;
revoke create on schema dekez_collections_private from dekez_collection_executor;
grant dekez_collection_executor to current_user with inherit false, set false;
commit;
