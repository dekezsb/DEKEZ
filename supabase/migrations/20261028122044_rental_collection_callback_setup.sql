-- REVIEW ONLY. Empty, operator-provisioned one-use callback authorization ledger.
-- This migration never issues an authorization, changes a credential, configures
-- Whapi, sends a message, or touches existing business / collection records.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $role_safety$ begin
 if not exists(select 1 from pg_roles where rolname='dekez_collection_executor' and not rolcanlogin
  and not rolinherit and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls) then
  raise exception 'Expected unprivileged collection executor is unavailable'; end if;
end $role_safety$;
grant dekez_collection_executor to current_user with inherit false, set true;
grant create on schema dekez_collections_private to dekez_collection_executor;

create table dekez_collections_private.callback_setup (
 id uuid primary key,
 company_id uuid not null references public.companies(id)
   check(company_id='660cc0c4-daee-445b-9146-ccd112e791d4'::uuid),
 channel text not null check(channel='FALCON-D9NS9'),
 operation_key text not null check(operation_key='rental_callback_v1'),
 approved_actor uuid not null references public.profiles(id),
 created_at timestamptz not null,
 expires_at timestamptz not null,
 revoked_at timestamptz,
 consumed_at timestamptz,
 before_hash text,
 after_hash text,
 deployment text,
 outcome text check(outcome in ('verified','preflight_failed','uncertain')),
 finished_at timestamptz,
 unique(company_id,operation_key),
 check(isfinite(created_at) and isfinite(expires_at) and expires_at>created_at
   and expires_at<=created_at+interval '15 minutes'),
 -- A not-yet-active permit must also be revocable immediately.
 check(revoked_at is null or isfinite(revoked_at)),
 check(consumed_at is null or (isfinite(consumed_at) and consumed_at>=created_at and consumed_at<expires_at)),
 check((consumed_at is null and before_hash is null and after_hash is null and deployment is null)
   or (consumed_at is not null and before_hash is not null and after_hash is not null and deployment is not null
     and before_hash ~ '^[a-f0-9]{64}$' and after_hash ~ '^[a-f0-9]{64}$'
     and deployment ~ '^dpl_[A-Za-z0-9]{8,100}$')),
 check((outcome is null and finished_at is null) or
   (outcome is not null and consumed_at is not null and finished_at is not null
    and isfinite(finished_at) and finished_at>=consumed_at))
);
alter table dekez_collections_private.callback_setup enable row level security;
alter table dekez_collections_private.callback_setup force row level security;
revoke all on dekez_collections_private.callback_setup from public,anon,authenticated,service_role,dekez_collection_executor;
grant select on dekez_collections_private.callback_setup to dekez_collection_executor;
grant update(consumed_at,before_hash,after_hash,deployment,outcome,finished_at)
 on dekez_collections_private.callback_setup to dekez_collection_executor;
create policy callback_setup_read on dekez_collections_private.callback_setup
 for select to dekez_collection_executor using(true);
create policy callback_setup_consume on dekez_collections_private.callback_setup
 for update to dekez_collection_executor using(true) with check(true);

-- Runtime can neither issue a row nor edit its identity, expiry or revocation.
-- No INSERT/DELETE/TRUNCATE grant, no issuance/reissue/reset function, no seed.
create function public.dekez_collection_setup_assert_admin(p_company uuid,p_actor uuid) returns void
language plpgsql security invoker set search_path='' set statement_timeout='10s' as $$
begin
 if current_user<>'service_role' then raise insufficient_privilege; end if;
 if p_company is distinct from '660cc0c4-daee-445b-9146-ccd112e791d4'::uuid or p_actor is null then
  raise insufficient_privilege using message='Approved callback setup scope required'; end if;
 perform public.dekez_collection_assert_admin(p_company,p_actor);
 if not exists(select 1 from public.profiles where id=p_actor and role::text='super_admin' and registration_status='approved')
  or exists(select 1 from public.user_module_permissions where profile_id=p_actor and module_key='admin_setup'
    and access_level::text is distinct from 'manage') then
  raise insufficient_privilege using message='Authorized company Super Admin required'; end if;
end $$;

create function dekez_collections_private.setup_check(p_company uuid,p_actor uuid,p_operation uuid) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set statement_timeout='10s' as $$
declare r dekez_collections_private.callback_setup; now_at timestamptz:=clock_timestamp(); state text;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 select * into r from dekez_collections_private.callback_setup where id=p_operation and company_id=p_company;
 if not found then return jsonb_build_object('state','missing'); end if;
 if r.approved_actor is distinct from p_actor then return jsonb_build_object('state','not_authorized'); end if;
 state:=case when r.revoked_at is not null then 'revoked' when now_at<r.created_at or now_at>=r.expires_at then 'expired'
  when r.consumed_at is not null then 'consumed' else 'ready' end;
 return jsonb_build_object('state',state,'expires_at',r.expires_at,'outcome',r.outcome,
  'consumed',r.consumed_at is not null,'before_hash',r.before_hash,'after_hash',r.after_hash,'deployment',r.deployment);
end $$;

create function dekez_collections_private.setup_claim(p_company uuid,p_actor uuid,p_operation uuid,p_before_hash text,p_after_hash text,p_deployment text) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set statement_timeout='10s' set lock_timeout='5s' as $$
declare r dekez_collections_private.callback_setup; now_at timestamptz;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_before_hash is null or p_before_hash !~ '^[a-f0-9]{64}$' or p_after_hash is null or p_after_hash !~ '^[a-f0-9]{64}$'
  or p_deployment is null or p_deployment !~ '^dpl_[A-Za-z0-9]{8,100}$' then
  raise exception 'Invalid callback setup reservation'; end if;
 select * into r from dekez_collections_private.callback_setup where id=p_operation and company_id=p_company for update;
 if not found then return jsonb_build_object('state','missing'); end if;
 if r.approved_actor is distinct from p_actor then return jsonb_build_object('state','not_authorized'); end if;
 if r.consumed_at is not null then return jsonb_build_object('state','used','expires_at',r.expires_at); end if;
 if r.revoked_at is not null then return jsonb_build_object('state','revoked'); end if;
 -- Read the clock after any lock wait. Never extend the operator's deadline.
 now_at:=clock_timestamp();
 if now_at<r.created_at or now_at>=r.expires_at then return jsonb_build_object('state','expired'); end if;
 update dekez_collections_private.callback_setup set consumed_at=now_at,before_hash=p_before_hash,
  after_hash=p_after_hash,deployment=p_deployment where id=r.id;
 return jsonb_build_object('state','claimed','expires_at',r.expires_at);
end $$;

create function dekez_collections_private.setup_finish(p_company uuid,p_actor uuid,p_operation uuid,p_outcome text) returns jsonb
language plpgsql security definer set search_path='' set row_security=on set statement_timeout='10s' set lock_timeout='5s' as $$
declare r dekez_collections_private.callback_setup;
begin
 if current_setting('role',true) is distinct from 'service_role' then raise insufficient_privilege; end if;
 if p_outcome is null or p_outcome not in ('verified','preflight_failed','uncertain') then raise exception 'Invalid callback setup outcome'; end if;
 select * into r from dekez_collections_private.callback_setup where id=p_operation and company_id=p_company for update;
 if not found then return jsonb_build_object('state','missing'); end if;
 if r.approved_actor is distinct from p_actor then return jsonb_build_object('state','not_authorized'); end if;
 if r.consumed_at is null then return jsonb_build_object('state','not_consumed'); end if;
 if r.outcome is not null then
  if r.outcome<>p_outcome then raise exception 'Callback setup outcome is immutable'; end if;
  return jsonb_build_object('state','already_finished','outcome',r.outcome);
 end if;
 -- Finish may record the result after expiry/revocation, but cannot renew a claim.
 update dekez_collections_private.callback_setup set outcome=p_outcome,finished_at=clock_timestamp() where id=r.id;
 return jsonb_build_object('state','recorded','outcome',p_outcome);
end $$;

create function public.dekez_collection_setup_check(p_company uuid,p_actor uuid,p_operation uuid) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='10s' as $$
begin
 perform public.dekez_collection_setup_assert_admin(p_company,p_actor);
 return dekez_collections_private.setup_check(p_company,p_actor,p_operation);
end $$;
create function public.dekez_collection_setup_claim(p_company uuid,p_actor uuid,p_operation uuid,p_before_hash text,p_after_hash text,p_deployment text) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='10s' set lock_timeout='5s' as $$
declare result jsonb;
begin
 perform public.dekez_collection_setup_assert_admin(p_company,p_actor);
 result:=dekez_collections_private.setup_claim(p_company,p_actor,p_operation,p_before_hash,p_after_hash,p_deployment);
 -- A demotion/revocation committed while waiting aborts the entire transaction.
 -- No additional business-table grants or policies are needed for the executor.
 perform public.dekez_collection_setup_assert_admin(p_company,p_actor);
 return result;
end $$;
create function public.dekez_collection_setup_finish(p_company uuid,p_actor uuid,p_operation uuid,p_outcome text) returns jsonb
language plpgsql security invoker set search_path='' set statement_timeout='10s' set lock_timeout='5s' as $$
declare result jsonb;
begin
 perform public.dekez_collection_setup_assert_admin(p_company,p_actor);
 result:=dekez_collections_private.setup_finish(p_company,p_actor,p_operation,p_outcome);
 perform public.dekez_collection_setup_assert_admin(p_company,p_actor);
 return result;
end $$;

revoke all on function dekez_collections_private.setup_check(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function dekez_collections_private.setup_finish(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function dekez_collections_private.setup_check(uuid,uuid,uuid) to service_role;
grant execute on function dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function dekez_collections_private.setup_finish(uuid,uuid,uuid,text) to service_role;
alter function dekez_collections_private.setup_check(uuid,uuid,uuid) owner to dekez_collection_executor;
alter function dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text) owner to dekez_collection_executor;
alter function dekez_collections_private.setup_finish(uuid,uuid,uuid,text) owner to dekez_collection_executor;
revoke all on function public.dekez_collection_setup_assert_admin(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.dekez_collection_setup_check(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.dekez_collection_setup_finish(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.dekez_collection_setup_assert_admin(uuid,uuid) to service_role;
grant execute on function public.dekez_collection_setup_check(uuid,uuid,uuid) to service_role;
grant execute on function public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.dekez_collection_setup_finish(uuid,uuid,uuid,text) to service_role;
revoke create on schema dekez_collections_private from dekez_collection_executor;
grant dekez_collection_executor to current_user with inherit false, set false;
notify pgrst,'reload schema';
commit;
