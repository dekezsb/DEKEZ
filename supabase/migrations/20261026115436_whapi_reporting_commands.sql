-- REVIEW ONLY: private, at-most-once reporting-command ledger. No external sends,
-- schedules, source-record changes or modifications to existing reporting RPCs.
-- Requires the three previously reviewed Whapi reporting migrations.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$ begin
 if not exists(select 1 from pg_catalog.pg_roles where rolname='dekez_report_executor'
   and not rolcanlogin and not rolinherit and not rolsuper and not rolcreatedb
   and not rolcreaterole and not rolreplication and not rolbypassrls) then
   raise exception 'Restricted reporting executor is required';
 end if;
 if to_regprocedure('public.dekez_management_report_snapshot(uuid,timestamp with time zone)') is null
   or to_regclass('dekez_reports_private.test_authorizations') is null then
   raise exception 'Reviewed reporting migrations are required';
 end if;
end $$;
grant dekez_report_executor to current_user with inherit false, set true;
grant create on schema dekez_reports_private to dekez_report_executor;

create table dekez_reports_private.command_requests (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 channel_id text not null check (channel_id='FALCON-D9NS9'),
 incoming_message_id text not null check (incoming_message_id ~ '^[A-Za-z0-9._-]{1,200}$'),
 sender text not null check (sender='60198894911'),
 chat_id text not null check (chat_id='60198894911@s.whatsapp.net'),
 command text not null check (command in ('due_overdue','collection','monthly','vacant','maintenance','full','help')),
 received_at timestamptz not null,
 report_date date not null,
 state text not null check (state in ('processing','rate_limited','accepted','rejected','uncertain','failed')),
 snapshot jsonb,
 message_body text check (length(message_body) between 1 and 4000),
 provider_message_id text check (provider_message_id ~ '^[A-Za-z0-9._-]{1,200}$'),
 http_status integer check (http_status between 100 and 599),
 error_code text check (error_code in ('provider_rejected','delivery_uncertain','report_unavailable','invalid_snapshot','worker_interrupted')),
 created_at timestamptz not null,
 prepared_at timestamptz,
 finished_at timestamptz,
 unique(channel_id,incoming_message_id),
 check (snapshot is null or (jsonb_typeof(snapshot)='object'
   and snapshot->>'company_id' is not distinct from company_id::text
   and snapshot->>'report_date' is not distinct from report_date::text
   and octet_length(snapshot::text)<=16000)),
 check ((state='processing')=(finished_at is null)),
 check (prepared_at is null or message_body is not null),
 check (state not in ('accepted','rejected','uncertain') or prepared_at is not null),
 check (state<>'accepted' or (provider_message_id is not null and message_body is not null and http_status is not null
   and http_status between 200 and 299 and error_code is null and (command='help' or snapshot is not null)))
);
-- Rolling-window claims are bounded to one authorized company/sender pair. Failed
-- and uncertain attempts still consume capacity; rate-limited events do not.
create index command_requests_rate_window on dekez_reports_private.command_requests(company_id,sender,created_at desc)
 where state<>'rate_limited';
alter table dekez_reports_private.command_requests enable row level security;
alter table dekez_reports_private.command_requests force row level security;
revoke all on dekez_reports_private.command_requests from public,anon,authenticated,service_role;
grant select,insert,update on dekez_reports_private.command_requests to dekez_report_executor;
create policy command_executor_select on dekez_reports_private.command_requests for select to dekez_report_executor using (true);
create policy command_executor_insert on dekez_reports_private.command_requests for insert to dekez_report_executor with check (true);
create policy command_executor_update on dekez_reports_private.command_requests for update to dekez_report_executor using (true) with check (true);

create function dekez_reports_private.command_claim(p_company uuid,p_channel text,p_message_id text,
 p_sender text,p_chat text,p_command text,p_received_at timestamptz)
returns jsonb language plpgsql security definer set search_path = ''
 set statement_timeout = '10s' set lock_timeout = '5s' set row_security = on as $$
declare r dekez_reports_private.command_requests; claimed_at timestamptz;
 minute_count bigint; hour_count bigint;
begin
 if current_setting('role',true) is distinct from 'service_role' then
   raise insufficient_privilege using message='Reporting server role required';
 end if;
 if p_company is null or p_channel is distinct from 'FALCON-D9NS9'
   or p_sender is distinct from '60198894911' or p_chat is distinct from '60198894911@s.whatsapp.net'
   or p_message_id is null or p_message_id !~ '^[A-Za-z0-9._-]{1,200}$'
   or p_command is null or p_command not in ('due_overdue','collection','monthly','vacant','maintenance','full','help')
   or p_received_at is null or not isfinite(p_received_at) then
   raise exception 'Invalid reporting command';
 end if;
 -- One short transaction serializes the rate-limit decision and permanent claim.
 -- There is deliberately no network call or recover/retry operation in this RPC.
 perform pg_advisory_xact_lock(hashtextextended('dekez-report-command:'||p_company::text||':'||p_sender,0));
 select * into r from dekez_reports_private.command_requests
   where channel_id=p_channel and incoming_message_id=p_message_id;
 if r.id is not null then
   return jsonb_build_object('claimed',false,'state','duplicate');
 end if;
 claimed_at:=clock_timestamp();
 if p_received_at<claimed_at-interval '15 minutes' or p_received_at>claimed_at+interval '60 seconds' then
   raise exception 'Stale reporting command';
 end if;
 select count(*) filter(where created_at>claimed_at-interval '1 minute'),count(*)
 into minute_count,hour_count from dekez_reports_private.command_requests
 where company_id=p_company and sender=p_sender and state<>'rate_limited'
   and created_at>claimed_at-interval '1 hour';
 insert into dekez_reports_private.command_requests(company_id,channel_id,incoming_message_id,sender,chat_id,
   command,received_at,report_date,state,created_at,finished_at)
 values(p_company,p_channel,p_message_id,p_sender,p_chat,p_command,p_received_at,
   (claimed_at at time zone 'Asia/Kuala_Lumpur')::date,
   case when minute_count>=6 or hour_count>=30 then 'rate_limited' else 'processing' end,
   claimed_at,case when minute_count>=6 or hour_count>=30 then claimed_at end)
 on conflict(channel_id,incoming_message_id) do nothing returning * into r;
 -- Global provider-message uniqueness also protects a misconfigured other company.
 if r.id is null then return jsonb_build_object('claimed',false,'state','duplicate'); end if;
 return jsonb_build_object('claimed',r.state='processing','request_id',r.id,'state',r.state,'report_date',r.report_date);
end $$;

-- Persist the exact aggregate and response before the external API call. This
-- one-shot preparation never returns a second permission to send the same claim.
create function dekez_reports_private.command_prepare(p_request uuid,p_snapshot jsonb,p_body text)
returns jsonb language plpgsql security definer set search_path = ''
 set statement_timeout = '10s' set lock_timeout = '5s' set row_security = on as $$
declare r dekez_reports_private.command_requests;
begin
 if current_setting('role',true) is distinct from 'service_role' then
   raise insufficient_privilege using message='Reporting server role required';
 end if;
 if p_body is null or length(p_body) not between 1 and 4000 then raise exception 'Invalid command body'; end if;
 select * into r from dekez_reports_private.command_requests where id=p_request for update;
 if r.id is null then raise exception 'Unknown command request'; end if;
 if r.state<>'processing' or r.prepared_at is not null then return jsonb_build_object('prepared',false,'state','already_prepared'); end if;
 if (r.command<>'help' and p_snapshot is null) or (p_snapshot is not null and (jsonb_typeof(p_snapshot)<>'object'
   or octet_length(p_snapshot::text)>16000 or p_snapshot->>'company_id' is distinct from r.company_id::text
   or p_snapshot->>'report_date' is distinct from r.report_date::text)) then raise exception 'Invalid command snapshot'; end if;
 update dekez_reports_private.command_requests set snapshot=p_snapshot,message_body=p_body,prepared_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('prepared',true,'body',p_body);
end $$;

create function dekez_reports_private.command_finish(p_request uuid,p_state text,p_snapshot jsonb default null,
 p_body text default null,p_provider_id text default null,p_http_status integer default null,p_error text default null)
returns void language plpgsql security definer set search_path = ''
 set statement_timeout = '10s' set lock_timeout = '5s' set row_security = on as $$
declare r dekez_reports_private.command_requests;
begin
 if current_setting('role',true) is distinct from 'service_role' then
   raise insufficient_privilege using message='Reporting server role required';
 end if;
 if p_state is null or p_state not in ('accepted','rejected','uncertain','failed')
   or (p_body is not null and length(p_body) not between 1 and 4000)
   or (p_provider_id is not null and p_provider_id !~ '^[A-Za-z0-9._-]{1,200}$')
   or (p_http_status is not null and p_http_status not between 100 and 599)
   or (p_error is not null and p_error not in ('provider_rejected','delivery_uncertain','report_unavailable','invalid_snapshot','worker_interrupted'))
   or (p_state='accepted' and (p_provider_id is null or p_body is null or p_http_status is null
      or p_http_status not between 200 and 299 or p_error is not null))
   or (p_state='rejected' and p_error is distinct from 'provider_rejected')
   or (p_state='uncertain' and p_error is distinct from 'delivery_uncertain')
   or (p_state='failed' and (p_error is null or p_error not in ('report_unavailable','invalid_snapshot','worker_interrupted'))) then
   raise exception 'Invalid command outcome';
 end if;
 select * into r from dekez_reports_private.command_requests where id=p_request for update;
 if r.id is null then raise exception 'Unknown command request'; end if;
 if p_snapshot is not null and (jsonb_typeof(p_snapshot)<>'object' or octet_length(p_snapshot::text)>16000
   or p_snapshot->>'company_id' is distinct from r.company_id::text
   or p_snapshot->>'report_date' is distinct from r.report_date::text) then
   raise exception 'Invalid command snapshot';
 end if;
 if p_state='accepted' and r.command<>'help' and p_snapshot is null then raise exception 'Command snapshot required'; end if;
 if p_state in ('accepted','rejected','uncertain') and r.prepared_at is null then raise exception 'Command preparation required'; end if;
 if r.prepared_at is not null and (r.snapshot is distinct from p_snapshot or r.message_body is distinct from p_body) then
   raise exception 'Prepared command audit cannot change';
 end if;
 -- Exact repeat of the finish call is harmless; a different outcome/body can
 -- never silently rewrite history, even when the provider result was uncertain.
 if r.state=p_state and r.snapshot is not distinct from p_snapshot and r.message_body is not distinct from p_body
   and r.provider_message_id is not distinct from p_provider_id and r.http_status is not distinct from p_http_status
   and r.error_code is not distinct from p_error then return; end if;
 if r.state<>'processing' then raise exception 'Command request already finalized'; end if;
 update dekez_reports_private.command_requests set state=p_state,snapshot=p_snapshot,message_body=p_body,
   provider_message_id=p_provider_id,http_status=p_http_status,error_code=p_error,finished_at=clock_timestamp()
 where id=r.id;
end $$;

revoke all on function dekez_reports_private.command_claim(uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function dekez_reports_private.command_prepare(uuid,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function dekez_reports_private.command_finish(uuid,text,jsonb,text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function dekez_reports_private.command_claim(uuid,text,text,text,text,text,timestamptz) to service_role;
grant execute on function dekez_reports_private.command_prepare(uuid,jsonb,text) to service_role;
grant execute on function dekez_reports_private.command_finish(uuid,text,jsonb,text,text,integer,text) to service_role;
alter function dekez_reports_private.command_claim(uuid,text,text,text,text,text,timestamptz) owner to dekez_report_executor;
alter function dekez_reports_private.command_prepare(uuid,jsonb,text) owner to dekez_report_executor;
alter function dekez_reports_private.command_finish(uuid,text,jsonb,text,text,integer,text) owner to dekez_report_executor;
revoke create on schema dekez_reports_private from dekez_report_executor;
grant dekez_report_executor to current_user with inherit false, set false;

create function public.dekez_report_command_claim(p_company uuid,p_channel text,p_message_id text,
 p_sender text,p_chat text,p_command text,p_received_at timestamptz)
returns jsonb language plpgsql security invoker set search_path = '' set statement_timeout = '10s' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege using message='Reporting server role required'; end if;
 if not exists(select 1 from public.companies where id=p_company) then raise exception 'Invalid report scope'; end if;
 return dekez_reports_private.command_claim(p_company,p_channel,p_message_id,p_sender,p_chat,p_command,p_received_at);
end $$;
create function public.dekez_report_command_prepare(p_request uuid,p_snapshot jsonb,p_body text)
returns jsonb language plpgsql security invoker set search_path = '' set statement_timeout = '10s' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege using message='Reporting server role required'; end if;
 return dekez_reports_private.command_prepare(p_request,p_snapshot,p_body);
end $$;
create function public.dekez_report_command_finish(p_request uuid,p_state text,p_snapshot jsonb default null,
 p_body text default null,p_provider_id text default null,p_http_status integer default null,p_error text default null)
returns void language plpgsql security invoker set search_path = '' set statement_timeout = '10s' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege using message='Reporting server role required'; end if;
 perform dekez_reports_private.command_finish(p_request,p_state,p_snapshot,p_body,p_provider_id,p_http_status,p_error);
end $$;

-- Read-only companion to the existing aggregate. Its invoice eligibility,
-- balances and canonical-person expression are identical to the reviewed daily
-- report. No invoice, payment, tenancy or accounting status is changed here.
create function public.dekez_report_due_snapshot(p_company uuid,p_as_of timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' set statement_timeout = '15s' as $$
declare d date := (p_as_of at time zone 'Asia/Kuala_Lumpur')::date; result jsonb;
begin
 if current_user<>'service_role' then raise insufficient_privilege using message='Reporting server role required'; end if;
 if p_as_of is null or not isfinite(p_as_of) or not exists(select 1 from public.companies where id=p_company) then
   raise exception 'Invalid report scope';
 end if;
 with scoped_properties as materialized (
   select id from public.properties where company_id=p_company
 ), bill_balances as materialized (
   select b.id,b.due_date,
     case when b.amount is not null and b.paid_amount is not null
       then greatest(b.amount + coalesce(items.total,0) - b.paid_amount,0) end balance,
     coalesce(t.profile_id,trt.profile_id,t.id,trt.id,b.tenant_id,b.tenant_record_id) person
   from public.rent_bills b
   left join public.tenancies tn on tn.id=b.tenancy_id
   left join public.tenants t on t.id=tn.tenant_id
   left join public.tenant_records tr on tr.id=b.tenant_record_id
   left join public.tenants trt on trt.id=tr.tenant_id
   left join lateral(select sum(i.amount) total from public.rental_invoice_line_items i where i.rent_bill_id=b.id) items on true
   where b.property_id in(select id from scoped_properties)
     and b.removed_at is null and b.status::text not in ('draft','cancelled','waived')
     and b.issued_at is not null and b.issued_at<=p_as_of
     and coalesce(b.invoice_date,b.bill_month)<=d
 ), balances as (
   select coalesce(sum(balance) filter(where due_date=d),0) due_today,
     count(distinct person) filter(where due_date=d and balance>0.005) due_today_tenants,
     count(*) filter(where due_date=d and balance>0.005) due_today_invoices,
     coalesce(sum(balance) filter(where due_date<d),0) overdue,
     count(distinct person) filter(where due_date<d and balance>0.005) overdue_tenants,
     count(*) filter(where due_date<d and balance>0.005) overdue_invoices,
     count(distinct person) filter(where due_date<=d and balance>0.005) combined_tenants,
     count(*) filter(where balance>0.005 and (due_date is null or person is null)) missing_context,
     count(*) filter(where balance is null) missing_amount
   from bill_balances
 )
 select jsonb_build_object('company_id',p_company,'report_date',d,'as_of',p_as_of,
   'due_today',case when missing_context=0 and missing_amount=0 then due_today end,
   'due_today_tenants',case when missing_context=0 and missing_amount=0 then due_today_tenants end,
   'due_today_invoices',case when missing_context=0 and missing_amount=0 then due_today_invoices end,
   'overdue',case when missing_context=0 and missing_amount=0 then overdue end,
   'overdue_tenants',case when missing_context=0 and missing_amount=0 then overdue_tenants end,
   'overdue_invoices',case when missing_context=0 and missing_amount=0 then overdue_invoices end,
   'combined_tenants',case when missing_context=0 and missing_amount=0 then combined_tenants end,
   'missing_bill_context',missing_context,'missing_bill_amount',missing_amount)
 into result from balances;
 return result;
end $$;

revoke all on function public.dekez_report_command_claim(uuid,text,text,text,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.dekez_report_command_prepare(uuid,jsonb,text) from public,anon,authenticated;
revoke all on function public.dekez_report_command_finish(uuid,text,jsonb,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.dekez_report_due_snapshot(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.dekez_report_command_claim(uuid,text,text,text,text,text,timestamptz) to service_role;
grant execute on function public.dekez_report_command_prepare(uuid,jsonb,text) to service_role;
grant execute on function public.dekez_report_command_finish(uuid,text,jsonb,text,text,integer,text) to service_role;
grant execute on function public.dekez_report_due_snapshot(uuid,timestamptz) to service_role;
commit;
