-- LOCAL REVIEW ONLY. Append-only evidence proposals; never consent, login or
-- financial approval. Requires the already-applied rental collection migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
grant dekez_collection_executor to current_user with inherit false, set true;
grant create on schema dekez_collections_private to dekez_collection_executor;

alter table dekez_collections_private.audit drop constraint audit_action_check;
alter table dekez_collections_private.audit add constraint audit_action_check check(action in (
 'case_checked','review_escalated','delivery_claimed','delivery_finished','contact_reviewed','contact_event',
 'delivery_receipt','failure_recipient_reviewed','failure_report_claimed','failure_report_finished',
 'failure_report_receipt','failure_report_draft_updated','worker_started','worker_finished','followup_resolved',
 'contact_evidence_submitted','contact_evidence_reviewed'));
create unique index collection_evidence_event_unique on dekez_collections_private.audit(company_id,action,record_id)
 where action in ('contact_evidence_submitted','contact_evidence_reviewed');
create index collection_evidence_list_idx on dekez_collections_private.audit(company_id,recorded_at desc,id desc)
 where action='contact_evidence_submitted';

create function public.dekez_collection_evidence_tenant(p_company uuid,p_actor uuid,p_tenant uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 select jsonb_build_object('tenant_id',p.id,'tenant_name',left(coalesce(p.full_name,'Tenant'),200),
  'login_phone_snapshot',left(p.phone,100)) into result from public.profiles p
 where p.id=p_tenant and p.role::text='tenant' and p.registration_status='approved'
  and exists(select 1 from public.tenants t join public.tenancies tn on tn.tenant_id=t.id
   join public.rooms r on r.id=tn.room_id and r.current_tenancy_id=tn.id and r.property_id=tn.property_id
   join public.properties pr on pr.id=tn.property_id and pr.company_id=p_company
   where t.profile_id=p.id and tn.company_id=p_company and tn.status::text='active'
    and tn.billing_status='active' and tn.checkout_date is null);
 if result is null then raise insufficient_privilege using message='Current company tenant relationship required'; end if;
 return result;
end $$;

create function dekez_collections_private.submit_evidence(p_company uuid,p_request uuid,p_details jsonb) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare prior jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_company is null or p_request is null or jsonb_typeof(p_details) is distinct from 'object'
  or p_details->>'actor' is null or p_details->>'tenant_id' is null then raise exception 'Invalid evidence request'; end if;
 insert into dekez_collections_private.audit(company_id,action,record_id,details)
 values(p_company,'contact_evidence_submitted',p_request::text,p_details)
 on conflict(company_id,action,record_id) where action in ('contact_evidence_submitted','contact_evidence_reviewed') do nothing;
 if found then return jsonb_build_object('state','pending','id',p_request); end if;
 select details into prior from dekez_collections_private.audit where company_id=p_company
  and action='contact_evidence_submitted' and record_id=p_request::text;
 if prior is distinct from p_details then raise exception 'Evidence request was already used for different details'; end if;
 return jsonb_build_object('state','already_submitted','id',p_request);
end $$;

create function public.dekez_collection_submit_evidence(p_company uuid,p_actor uuid,p_tenant uuid,p_request uuid,
 p_kind text,p_observed_on date,p_source text,p_reference text,p_notes text,p_proposed_phone text default null) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare identity jsonb;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 if p_request is null or p_tenant is null or p_kind is null or p_kind not in ('contact_confirmation','consent_evidence','phone_correction')
  or p_observed_on is null or p_observed_on>(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date
  or p_observed_on<'1900-01-01'::date or p_source is null
  or p_source not in ('in_person','tenant_initiated_whatsapp','phone_call','document','other')
  or p_reference is null or length(btrim(p_reference)) not between 10 and 500 or p_reference ~ '[[:cntrl:]]'
  or p_notes is null or length(btrim(p_notes)) not between 10 and 500 or p_notes ~ '[[:cntrl:]]'
  then raise exception 'Actual dated and referenced tenant evidence required'; end if;
 if p_kind='phone_correction' then
  if p_proposed_phone is null or p_proposed_phone !~ '^[1-9][0-9]{8,14}$'
   or (p_proposed_phone like '60%' and p_proposed_phone !~ '^601[0-9]{8,9}$')
   or p_proposed_phone in ('60198894911','60168173911','60188702371') then raise exception 'Tenant number proposal required'; end if;
 elsif p_proposed_phone is not null then raise exception 'Number proposal requires phone correction type'; end if;
 perform pg_advisory_xact_lock(hashtextextended('collection-evidence:'||p_company::text||':'||p_request::text,0));
 -- Recheck revoked access and current tenancy after any lock wait.
 identity:=public.dekez_collection_evidence_tenant(p_company,p_actor,p_tenant);
 return dekez_collections_private.submit_evidence(p_company,p_request,identity||jsonb_build_object(
  'actor',p_actor,'kind',p_kind,'observed_on',p_observed_on,'source',p_source,
  'reference',btrim(p_reference),'notes',btrim(p_notes),'proposed_phone',p_proposed_phone));
end $$;

create function dekez_collections_private.get_evidence(p_company uuid,p_proposal uuid) returns jsonb
language plpgsql security definer set search_path='' set row_security=on as $$
declare result jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 select details into result from dekez_collections_private.audit where company_id=p_company
  and action='contact_evidence_submitted' and record_id=p_proposal::text;
 return result;
end $$;

create function dekez_collections_private.list_evidence(p_company uuid,p_after text,p_limit integer) returns jsonb
language plpgsql security definer set search_path='' set row_security=on as $$
declare result jsonb; cursor_time timestamptz; cursor_id uuid;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_company is null or p_limit is null or p_limit<1 or p_limit>25 then raise exception 'Bounded evidence page required'; end if;
 if p_after is not null then cursor_time:=split_part(p_after,'|',1)::timestamptz; cursor_id:=split_part(p_after,'|',2)::uuid; end if;
 with limited as (
  select a.* from dekez_collections_private.audit a where a.company_id=p_company and a.action='contact_evidence_submitted'
   and (p_after is null or (a.recorded_at,a.id)<(cursor_time,cursor_id)) order by a.recorded_at desc,a.id desc limit p_limit+1
 ), page as(select * from limited order by recorded_at desc,id desc limit p_limit)
 select jsonb_build_object('items',coalesce((select jsonb_agg(p.details||jsonb_build_object(
  'id',p.record_id,'submitted_at',p.recorded_at,'status',coalesce(r.details->>'decision','pending'),
  'review',case when r.id is null then null else r.details||jsonb_build_object('reviewed_at',r.recorded_at) end)
  order by p.recorded_at desc,p.id desc) from page p left join dekez_collections_private.audit r
   on r.company_id=p.company_id and r.record_id=p.record_id and r.action='contact_evidence_reviewed'),'[]'::jsonb),
  'next_cursor',case when (select count(*) from limited)>p_limit then
   (select to_char(recorded_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||'|'||id::text from page order by recorded_at,id limit 1) else null end) into result;
 return result;
end $$;

create function public.dekez_collection_list_evidence(p_company uuid,p_actor uuid,p_after text default null,p_limit integer default 25) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='15s' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 return dekez_collections_private.list_evidence(p_company,p_after,p_limit);
end $$;

create function dekez_collections_private.review_evidence(p_company uuid,p_actor uuid,p_proposal uuid,p_decision text,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set lock_timeout='5s' as $$
declare prior jsonb; details_value jsonb;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_actor is null or p_proposal is null or p_decision is null or p_decision not in ('reviewed','rejected','needs_information')
  or p_reason is null or length(btrim(p_reason)) not between 10 and 500 or p_reason ~ '[[:cntrl:]]'
  then raise exception 'Evidence disposition and reason required'; end if;
 if not exists(select 1 from dekez_collections_private.audit where company_id=p_company
  and record_id=p_proposal::text and action='contact_evidence_submitted') then raise insufficient_privilege; end if;
 details_value:=jsonb_build_object('actor',p_actor,'decision',p_decision,'reason',btrim(p_reason));
 insert into dekez_collections_private.audit(company_id,action,record_id,details)
 values(p_company,'contact_evidence_reviewed',p_proposal::text,details_value)
 on conflict(company_id,action,record_id) where action in ('contact_evidence_submitted','contact_evidence_reviewed') do nothing;
 if found then return jsonb_build_object('state','reviewed','id',p_proposal); end if;
 select details into prior from dekez_collections_private.audit where company_id=p_company
  and record_id=p_proposal::text and action='contact_evidence_reviewed';
 if prior is distinct from details_value then raise exception 'Evidence disposition is immutable; submit new evidence for further review'; end if;
 return jsonb_build_object('state','already_reviewed','id',p_proposal);
end $$;

create function public.dekez_collection_review_evidence(p_company uuid,p_actor uuid,p_proposal uuid,p_decision text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare proposal jsonb; identity jsonb;
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 perform pg_advisory_xact_lock(hashtextextended('collection-evidence:'||p_company::text||':'||p_proposal::text,0));
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 -- Management may collect evidence but may not approve or dispose of it.
 if not exists(select 1 from public.profiles where id=p_actor and role::text='super_admin' and registration_status='approved')
  or exists(select 1 from public.user_module_permissions where profile_id=p_actor and module_key='admin_setup'
    and access_level::text is distinct from 'manage') then raise insufficient_privilege using message='Super Admin evidence review required'; end if;
 proposal:=dekez_collections_private.get_evidence(p_company,p_proposal);
 if proposal is null then raise insufficient_privilege; end if;
 if p_decision='reviewed' then
  identity:=public.dekez_collection_evidence_tenant(p_company,p_actor,(proposal->>'tenant_id')::uuid);
  if identity->'login_phone_snapshot' is distinct from proposal->'login_phone_snapshot' then
   raise exception 'Login number changed; obtain fresh evidence'; end if;
 end if;
 return dekez_collections_private.review_evidence(p_company,p_actor,p_proposal,p_decision,p_reason);
end $$;

-- Exact new-function allowlists only. Private audit remains forced-RLS and
-- append-only for the executor; no direct service-role or portal table access.
do $grants$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='dekez_collections_private' and p.proname in ('submit_evidence','get_evidence','list_evidence','review_evidence') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
  execute format('alter function %s owner to dekez_collection_executor',f.signature);
 end loop;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('dekez_collection_evidence_tenant','dekez_collection_submit_evidence','dekez_collection_list_evidence','dekez_collection_review_evidence') loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $grants$;
revoke create on schema dekez_collections_private from dekez_collection_executor;
grant dekez_collection_executor to current_user with inherit false, set false;
commit;
