-- REVIEW ONLY: one-time TEST authorization; no schedule, provider calls, or source-data writes.
-- Requires the already-applied 20261025083739_whapi_management_reports.sql migration.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Fail closed if the reviewed internal execution role has been broadened.
do $$ begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname='dekez_report_executor'
   and not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb
   and not rolcreaterole and not rolreplication and not rolbypassrls) then
   raise exception 'Restricted reporting executor is required';
 end if;
end $$;
grant dekez_report_executor to current_user with inherit false, set true;
grant create on schema dekez_reports_private to dekez_report_executor;

create table dekez_reports_private.test_authorizations (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 report_date date not null,
 recipient text not null check (recipient='60168173911'),
 requested_by uuid not null references public.profiles(id),
 snapshot jsonb not null,
 message_body text not null check (length(message_body) between 7 and 4000 and left(message_body,6)='[TEST]'),
 created_at timestamptz not null,
 expires_at timestamptz not null,
 consumed_at timestamptz,
 revoked_at timestamptz,
 run_id uuid unique references dekez_reports_private.report_runs(id),
 attempt_id uuid unique references dekez_reports_private.delivery_attempts(id),
 check (expires_at>created_at and expires_at<=created_at+interval '5 minutes'),
 check (jsonb_typeof(snapshot)='object' and snapshot->>'company_id' is not distinct from company_id::text
   and snapshot->>'report_date' is not distinct from report_date::text),
 check ((run_id is null)=(attempt_id is null)),
 check (run_id is null or consumed_at is not null),
 check (consumed_at is null or revoked_at is null)
);
create index test_authorizations_actor_created on dekez_reports_private.test_authorizations(requested_by,created_at desc);
alter table dekez_reports_private.test_authorizations enable row level security;
alter table dekez_reports_private.test_authorizations force row level security;
revoke all on dekez_reports_private.test_authorizations from public,anon,authenticated,service_role;
grant select,insert,update on dekez_reports_private.test_authorizations to dekez_report_executor;
create policy report_executor_select on dekez_reports_private.test_authorizations for select to dekez_report_executor using (true);
create policy report_executor_insert on dekez_reports_private.test_authorizations for insert to dekez_report_executor with check (true);
create policy report_executor_update on dekez_reports_private.test_authorizations for update to dekez_report_executor using (true) with check (true);

create function dekez_reports_private.authorize_test(p_company uuid,p_date date,p_recipient text,p_snapshot jsonb,p_body text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '10s' set row_security = on as $$
declare a dekez_reports_private.test_authorizations; issued timestamptz:=clock_timestamp();
begin
 if current_setting('role',true) is distinct from 'service_role' then
   raise insufficient_privilege using message='Reporting server role required';
 end if;
 if p_company is null or p_actor is null or p_recipient is distinct from '60168173911'
   or p_date is distinct from (issued at time zone 'Asia/Kuala_Lumpur')::date
   or p_snapshot is null or jsonb_typeof(p_snapshot)<>'object'
   or p_snapshot->>'company_id' is distinct from p_company::text
   or p_snapshot->>'report_date' is distinct from p_date::text
   or p_body is null or length(p_body) not between 7 and 4000 or left(p_body,6)<>'[TEST]' then
   raise exception 'Invalid test report authorization';
 end if;
 -- Any previous test attempt for this recipient/company/day blocks this flow,
 -- including a rejection, interruption or uncertain provider result.
 if exists(select 1 from dekez_reports_private.report_runs
   where company_id=p_company and report_date=p_date and recipient=p_recipient and kind='test') then
   return jsonb_build_object('state','duplicate');
 end if;
 insert into dekez_reports_private.test_authorizations(company_id,report_date,recipient,requested_by,snapshot,message_body,created_at,expires_at)
 values(p_company,p_date,p_recipient,p_actor,p_snapshot,p_body,issued,
   least(issued+interval '5 minutes',(p_date+1)::timestamp at time zone 'Asia/Kuala_Lumpur')) returning * into a;
 return jsonb_build_object('authorization_id',a.id,'expires_at',a.expires_at,
   'report_date',a.report_date,'recipient',a.recipient,'body',a.message_body,'company_id',a.company_id);
end $$;

create function dekez_reports_private.consume_test(p_authorization uuid,p_company uuid,p_recipient text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '10s' set lock_timeout = '5s' set row_security = on as $$
declare a dekez_reports_private.test_authorizations; run uuid; attempt uuid; checked timestamptz;
begin
 if current_setting('role',true) is distinct from 'service_role' then
   raise insufficient_privilege using message='Reporting server role required';
 end if;
 select * into a from dekez_reports_private.test_authorizations where id=p_authorization for update;
 if a.id is null or p_actor is distinct from a.requested_by or p_company is distinct from a.company_id
   or p_recipient is distinct from a.recipient or p_recipient is distinct from '60168173911' then
   return jsonb_build_object('claimed',false,'state','not_authorized');
 end if;
 if a.consumed_at is not null then return jsonb_build_object('claimed',false,'state','consumed'); end if;
 if a.revoked_at is not null then return jsonb_build_object('claimed',false,'state','not_authorized'); end if;
 -- Use wall-clock time AFTER waiting for the row lock, not transaction-start now().
 checked:=clock_timestamp();
 if checked>=a.expires_at or a.report_date<>(checked at time zone 'Asia/Kuala_Lumpur')::date then
   return jsonb_build_object('claimed',false,'state','expired');
 end if;
 -- Consume and reserve in the SAME transaction. Unique report key arbitrates
 -- simultaneous requests with different grants without ever making two attempts.
 update dekez_reports_private.test_authorizations set consumed_at=checked where id=a.id;
 insert into dekez_reports_private.report_runs(company_id,report_date,recipient,kind,state,snapshot,message_body,requested_by)
 values(a.company_id,a.report_date,a.recipient,'test','sending',a.snapshot,a.message_body,a.requested_by)
 on conflict(company_id,report_date,recipient,kind) do nothing returning id into run;
 if run is null then return jsonb_build_object('claimed',false,'state','duplicate'); end if;
 -- INSERT may itself wait for a conflicting uncommitted report key. Recheck
 -- expiry after all such waiting; raising rolls back consumption and reservation.
 checked:=clock_timestamp();
 if checked>=a.expires_at or a.report_date<>(checked at time zone 'Asia/Kuala_Lumpur')::date then
   raise exception using errcode='22023',message='Test authorization expired before reservation';
 end if;
 insert into dekez_reports_private.delivery_attempts(run_id,attempt_number,state,requested_by)
 values(run,1,'sending',a.requested_by) returning id into attempt;
 update dekez_reports_private.test_authorizations set run_id=run,attempt_id=attempt where id=a.id;
 return jsonb_build_object('claimed',true,'run_id',run,'attempt_id',attempt,'body',a.message_body,
   'recipient',a.recipient,'company_id',a.company_id,'report_date',a.report_date);
end $$;

create function dekez_reports_private.revoke_test(p_authorization uuid,p_company uuid,p_recipient text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '10s' set lock_timeout = '5s' set row_security = on as $$
declare a dekez_reports_private.test_authorizations;
begin
 if current_setting('role',true) is distinct from 'service_role' then
   raise insufficient_privilege using message='Reporting server role required';
 end if;
 select * into a from dekez_reports_private.test_authorizations where id=p_authorization for update;
 if a.id is null or p_actor is distinct from a.requested_by or p_company is distinct from a.company_id
   or p_recipient is distinct from a.recipient or p_recipient is distinct from '60168173911' then
   return jsonb_build_object('revoked',false,'state','not_authorized');
 end if;
 if a.consumed_at is not null then return jsonb_build_object('revoked',false,'state','consumed'); end if;
 update dekez_reports_private.test_authorizations set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=a.id;
 return jsonb_build_object('revoked',true,'state','revoked');
end $$;

-- Preserve the reviewed internal executor: table access ONLY inside these
-- non-exposed implementations; no source-table grants or DELETE/TRUNCATE.
revoke all on function dekez_reports_private.authorize_test(uuid,date,text,jsonb,text,uuid) from public,anon,authenticated,service_role;
revoke all on function dekez_reports_private.consume_test(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function dekez_reports_private.revoke_test(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
grant execute on function dekez_reports_private.authorize_test(uuid,date,text,jsonb,text,uuid) to service_role;
grant execute on function dekez_reports_private.consume_test(uuid,uuid,text,uuid) to service_role;
grant execute on function dekez_reports_private.revoke_test(uuid,uuid,text,uuid) to service_role;
alter function dekez_reports_private.authorize_test(uuid,date,text,jsonb,text,uuid) owner to dekez_report_executor;
alter function dekez_reports_private.consume_test(uuid,uuid,text,uuid) owner to dekez_report_executor;
alter function dekez_reports_private.revoke_test(uuid,uuid,text,uuid) owner to dekez_report_executor;
revoke create on schema dekez_reports_private from dekez_report_executor;
grant dekez_report_executor to current_user with inherit false, set false;

-- Public RPCs use the server's existing source permissions for fresh profile
-- checks. Browser roles receive NO execute privilege, even with forged metadata.
create function public.dekez_management_report_authorize_test(p_company uuid,p_date date,p_recipient text,p_snapshot jsonb,p_body text,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = '' set statement_timeout = '10s' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege using message='Reporting server role required'; end if;
 if not exists(select 1 from public.profiles where id=p_actor and role::text='super_admin' and registration_status='approved') then
   raise insufficient_privilege using message='Administrator required';
 end if;
 return dekez_reports_private.authorize_test(p_company,p_date,p_recipient,p_snapshot,p_body,p_actor);
end $$;

create function public.dekez_management_report_consume_test(p_authorization uuid,p_company uuid,p_recipient text,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = '' set statement_timeout = '10s' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege using message='Reporting server role required'; end if;
 if not exists(select 1 from public.profiles where id=p_actor and role::text='super_admin' and registration_status='approved') then
   raise insufficient_privilege using message='Administrator required';
 end if;
 return dekez_reports_private.consume_test(p_authorization,p_company,p_recipient,p_actor);
end $$;

create function public.dekez_management_report_revoke_test(p_authorization uuid,p_company uuid,p_recipient text,p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = '' set statement_timeout = '10s' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege using message='Reporting server role required'; end if;
 if not exists(select 1 from public.profiles where id=p_actor and role::text='super_admin' and registration_status='approved') then
   raise insufficient_privilege using message='Administrator required';
 end if;
 return dekez_reports_private.revoke_test(p_authorization,p_company,p_recipient,p_actor);
end $$;

revoke all on function public.dekez_management_report_authorize_test(uuid,date,text,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.dekez_management_report_consume_test(uuid,uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.dekez_management_report_revoke_test(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.dekez_management_report_authorize_test(uuid,date,text,jsonb,text,uuid) to service_role;
grant execute on function public.dekez_management_report_consume_test(uuid,uuid,text,uuid) to service_role;
grant execute on function public.dekez_management_report_revoke_test(uuid,uuid,text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
