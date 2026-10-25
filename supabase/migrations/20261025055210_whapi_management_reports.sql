-- REVIEW ONLY. No schedules, external sends or changes to operational records.
begin;
create schema dekez_reports_private;
revoke all on schema dekez_reports_private from public, anon, authenticated;
grant usage on schema dekez_reports_private to service_role;

create table dekez_reports_private.report_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  report_date date not null,
  recipient text not null check (recipient ~ '^[1-9][0-9]{8,14}$'),
  kind text not null check (kind in ('daily','test')),
  state text not null check (state in ('sending','accepted','rejected','uncertain')),
  snapshot jsonb not null,
  message_body text not null check (length(message_body) between 1 and 4000),
  requested_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, report_date, recipient, kind)
);
create table dekez_reports_private.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references dekez_reports_private.report_runs(id),
  attempt_number integer not null check (attempt_number between 1 and 3),
  state text not null check (state in ('sending','accepted','rejected','uncertain')),
  provider_message_id text,
  http_status integer,
  error_code text check (error_code in ('provider_rejected','delivery_uncertain','worker_interrupted')),
  requested_by uuid references public.profiles(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(run_id,attempt_number)
);
alter table dekez_reports_private.report_runs enable row level security;
alter table dekez_reports_private.delivery_attempts enable row level security;
revoke all on all tables in schema dekez_reports_private from public, anon, authenticated;
grant select, insert, update on all tables in schema dekez_reports_private to service_role;
-- No ordinary-user policy: service-only access, never a public report directory.

create function public.dekez_management_report_snapshot(p_company uuid, p_as_of timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = '' set statement_timeout = '15s' as $$
declare d date := (p_as_of at time zone 'Asia/Kuala_Lumpur')::date; result jsonb;
begin
 if p_as_of is null or not exists(select 1 from public.companies where id=p_company) then
   raise exception 'Invalid report scope';
 end if;
 -- One statement snapshot; aggregate inside Postgres, not a truncated frontend list.
 with scoped_properties as materialized (
   select id from public.properties where company_id=p_company
 ), collections as (
   select coalesce(sum(p.amount) filter(where p.payment_date=d),0) today,
          coalesce(sum(p.amount),0) month_to_date
   from public.payments p
   where p.company_id=p_company and p.category='monthly_rent'
     and p.status::text='confirmed' and p.reversed_at is null
     and p.payment_date between date_trunc('month',d)::date and d
     and (p.property_id is null or p.property_id in(select id from scoped_properties))
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
   select coalesce(sum(balance),0) outstanding,
     coalesce(sum(balance) filter(where due_date<d),0) overdue,
     count(distinct person) filter(where due_date<d and balance>0.005) overdue_tenants,
     count(*) filter(where balance>0.005 and (due_date is null or person is null)) missing_context,
     count(*) filter(where balance is null) missing_amount
   from bill_balances
 ), verification as (
   select count(*) pending_count,coalesce(sum(amount),0) pending_amount
   from public.payment_submissions
   where property_id in(select id from scoped_properties) and verification_status='pending_verification'
 ), occupancy as (
   select count(*) total, count(*) filter(where status::text='occupied') occupied,
     count(*) filter(where status::text='vacant') vacant,
     count(*) filter(where status::text='reserved') reserved,
     count(*) filter(where status::text='maintenance') maintenance
   from public.rooms where property_id in(select id from scoped_properties)
 ), maintenance as (
   select count(*) filter(where status::text in ('submitted','assigned','in_progress','waiting_for_parts')) active,
     count(*) filter(where status::text in ('submitted','assigned','in_progress','waiting_for_parts') and urgency::text='urgent') urgent,
     count(*) filter(where status::text='waiting_for_parts') waiting_for_parts
   from public.maintenance_tickets where property_id in(select id from scoped_properties)
     and ticket_type::text in ('maintenance','repair')
 )
 select jsonb_build_object('report_date',d,'as_of',p_as_of,'company_id',p_company,
   'collected_today',c.today,'collected_month',c.month_to_date,
   'outstanding',case when b.missing_amount=0 then b.outstanding end,
   'overdue',case when b.missing_amount=0 and b.missing_context=0 then b.overdue end,
   'overdue_tenants',case when b.missing_amount=0 and b.missing_context=0 then b.overdue_tenants end,
   'pending_count',v.pending_count,'pending_amount',v.pending_amount,
   'rooms_total',o.total,'occupied',o.occupied,'vacant',o.vacant,'reserved',o.reserved,'maintenance_rooms',o.maintenance,
   'maintenance_active',m.active,'maintenance_urgent',m.urgent,'waiting_for_parts',m.waiting_for_parts,
   'missing_bill_context',b.missing_context,'missing_bill_amount',b.missing_amount)
 into result from collections c cross join balances b cross join verification v cross join occupancy o cross join maintenance m;
 return result;
end $$;

create function public.dekez_management_report_claim(p_company uuid,p_date date,p_recipient text,p_kind text,
 p_snapshot jsonb,p_body text,p_actor uuid default null)
returns jsonb language plpgsql security invoker set search_path = '' set statement_timeout = '10s' as $$
declare r dekez_reports_private.report_runs; a dekez_reports_private.delivery_attempts; n integer;
begin
 if p_kind is null or p_kind not in ('daily','test') or p_date is null or p_snapshot is null
   or p_snapshot->>'company_id' is distinct from p_company::text
   or p_snapshot->>'report_date' is distinct from p_date::text then raise exception 'Invalid report'; end if;
 if p_kind='test' and not exists(select 1 from public.profiles where id=p_actor and role::text='super_admin' and registration_status='approved') then
   raise exception 'Administrator required';
 end if;
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

create function public.dekez_management_report_finish(p_attempt uuid,p_state text,p_provider_id text default null,
 p_http_status integer default null,p_error text default null)
returns void language plpgsql security invoker set search_path = '' as $$
declare a dekez_reports_private.delivery_attempts;
begin
 if p_state is null or p_state not in ('accepted','rejected','uncertain') or (p_state='accepted' and nullif(p_provider_id,'') is null)
   or length(p_provider_id)>200 then raise exception 'Invalid outcome'; end if;
 select * into a from dekez_reports_private.delivery_attempts where id=p_attempt;
 if a.id is null then raise exception 'Unknown attempt'; end if;
 perform 1 from dekez_reports_private.report_runs where id=a.run_id for update;
 select * into a from dekez_reports_private.delivery_attempts where id=p_attempt for update;
 if a.state=p_state then return; end if;
 if a.state<>'sending' then raise exception 'Attempt already finalized'; end if;
 update dekez_reports_private.delivery_attempts set state=p_state,provider_message_id=p_provider_id,
   http_status=p_http_status,error_code=p_error,finished_at=now() where id=a.id;
 update dekez_reports_private.report_runs set state=p_state,updated_at=now() where id=a.run_id;
end $$;

revoke all on function public.dekez_management_report_snapshot(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.dekez_management_report_claim(uuid,date,text,text,jsonb,text,uuid) from public,anon,authenticated;
revoke all on function public.dekez_management_report_finish(uuid,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.dekez_management_report_snapshot(uuid,timestamptz) to service_role;
grant execute on function public.dekez_management_report_claim(uuid,date,text,text,jsonb,text,uuid) to service_role;
grant execute on function public.dekez_management_report_finish(uuid,text,text,integer,text) to service_role;
commit;
