-- REVIEW ONLY: route future reports to the approved personal recipient.
-- Applies AFTER 20261025145221. Never edit/reapply either historical migration.
-- No source-record writes, provider calls, schedules or new runtime privileges.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$ begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname='dekez_report_executor'
   and not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb
   and not rolcreaterole and not rolreplication and not rolbypassrls)
   or has_schema_privilege('dekez_report_executor','dekez_reports_private','CREATE') then
   raise exception 'Restricted reporting executor is required';
 end if;
 if (select count(*) from pg_catalog.pg_proc p
     join pg_catalog.pg_namespace n on n.oid=p.pronamespace
     where n.nspname='dekez_reports_private'
       and p.proname in ('authorize_test','consume_test','revoke_test','claim')
       and p.proowner='dekez_report_executor'::regrole)<>4 then
   raise exception 'Reviewed reporting functions are required';
 end if;
end $$;

-- STORAGE ONLY: the old destination remains valid for immutable historical rows.
-- This is NOT a send allowlist. All four entry points below require ONLY the new
-- approved recipient, including stale deployments using the ordinary claim path.
alter table dekez_reports_private.test_authorizations
 drop constraint test_authorizations_recipient_check,
 add constraint test_authorizations_recipient_check
 check (recipient in ('60168173911','60198894911'));

-- Replacement needs ownership privileges even for the non-superuser migrator.
-- Temporary inheritance is confined to this transaction and restored below.
-- CREATE OR REPLACE preserves function identities, owners and existing ACLs.
grant dekez_report_executor to current_user with inherit true, set true;

create or replace function dekez_reports_private.authorize_test(p_company uuid,p_date date,p_recipient text,p_snapshot jsonb,p_body text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '10s' set row_security = on as $$
declare a dekez_reports_private.test_authorizations; issued timestamptz:=clock_timestamp();
begin
 if current_setting('role',true) is distinct from 'service_role' then
   raise insufficient_privilege using message='Reporting server role required';
 end if;
 if p_company is null or p_actor is null or p_recipient is distinct from '60198894911'
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

create or replace function dekez_reports_private.consume_test(p_authorization uuid,p_company uuid,p_recipient text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '10s' set lock_timeout = '5s' set row_security = on as $$
declare a dekez_reports_private.test_authorizations; run uuid; attempt uuid; checked timestamptz;
begin
 if current_setting('role',true) is distinct from 'service_role' then
   raise insufficient_privilege using message='Reporting server role required';
 end if;
 select * into a from dekez_reports_private.test_authorizations where id=p_authorization for update;
 if a.id is null or p_actor is distinct from a.requested_by or p_company is distinct from a.company_id
   or p_recipient is distinct from a.recipient or p_recipient is distinct from '60198894911' then
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

create or replace function dekez_reports_private.revoke_test(p_authorization uuid,p_company uuid,p_recipient text,p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '10s' set lock_timeout = '5s' set row_security = on as $$
declare a dekez_reports_private.test_authorizations;
begin
 if current_setting('role',true) is distinct from 'service_role' then
   raise insufficient_privilege using message='Reporting server role required';
 end if;
 select * into a from dekez_reports_private.test_authorizations where id=p_authorization for update;
 if a.id is null or p_actor is distinct from a.requested_by or p_company is distinct from a.company_id
   or p_recipient is distinct from a.recipient or p_recipient is distinct from '60198894911' then
   return jsonb_build_object('revoked',false,'state','not_authorized');
 end if;
 if a.consumed_at is not null then return jsonb_build_object('revoked',false,'state','consumed'); end if;
 update dekez_reports_private.test_authorizations set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=a.id;
 return jsonb_build_object('revoked',true,'state','revoked');
end $$;

create or replace function dekez_reports_private.claim(p_company uuid,p_date date,p_recipient text,p_kind text,
 p_snapshot jsonb,p_body text,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '10s' set row_security = on as $$
declare r dekez_reports_private.report_runs; a dekez_reports_private.delivery_attempts; n integer;
begin
 -- PostgreSQL's actual SET ROLE, not editable JWT/profile metadata. Cron has no auth.uid().
 if current_setting('role',true) is distinct from 'service_role' then
   raise insufficient_privilege using message='Reporting server role required';
 end if;
 if p_recipient is distinct from '60198894911' or p_kind is null or p_kind not in ('daily','test') or p_date is null or p_snapshot is null
   or p_snapshot->>'company_id' is distinct from p_company::text
   or p_snapshot->>'report_date' is distinct from p_date::text then raise exception 'Invalid report'; end if;
 insert into dekez_reports_private.report_runs(company_id,report_date,recipient,kind,state,snapshot,message_body,requested_by)
 values(p_company,p_date,p_recipient,p_kind,'sending',p_snapshot,p_body,p_actor)
 on conflict(company_id,report_date,recipient,kind) do nothing;
 select * into r from dekez_reports_private.report_runs
 where company_id=p_company and report_date=p_date and recipient=p_recipient and kind=p_kind for update;
 select * into a from dekez_reports_private.delivery_attempts where run_id=r.id order by attempt_number desc limit 1;
 if a.id is not null then
   if r.state='sending' and a.started_at<now()-interval '5 minutes' then
     update dekez_reports_private.report_runs set state='uncertain',updated_at=now() where id=r.id;
     update dekez_reports_private.delivery_attempts set state='uncertain',error_code='worker_interrupted',finished_at=now() where id=a.id;
     return jsonb_build_object('claimed',false,'state','uncertain');
   end if;
   -- No automatic retry after timeout/unknown or acceptance. Rejections may be
   -- retried by an authorized re-invocation after cooling down, at most 3 times.
   if r.state<>'rejected' or a.attempt_number>=3 or a.finished_at>now()-interval '5 minutes' then
     return jsonb_build_object('claimed',false,'state',r.state);
   end if;
 end if;
 n:=coalesce(a.attempt_number,0)+1;
 insert into dekez_reports_private.delivery_attempts(run_id,attempt_number,state,requested_by)
 values(r.id,n,'sending',p_actor) returning * into a;
 update dekez_reports_private.report_runs set state='sending',updated_at=now() where id=r.id;
 return jsonb_build_object('claimed',true,'run_id',r.id,'attempt_id',a.id,'body',r.message_body);
end $$;

-- No browser/service-role table grants, new RPCs or policy changes.
grant dekez_report_executor to current_user with inherit false, set false;
notify pgrst,'reload schema';
commit;
