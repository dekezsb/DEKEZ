-- REVIEW ONLY: cleanup after the separately approved temporary setup operation.
-- Run ONLY on explicit cleanup approval; retain the audit ledger. No sends.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
-- Capture the actual operator, not session_user: managed connections may enter
-- through SET ROLE. Owner-granted EXECUTE needs revocation as that function owner.
select set_config('dekez.callback_retire.operator',current_user,true);
select set_config('dekez.callback_retire.memberships',coalesce((
 select jsonb_agg(to_jsonb(m) order by m.grantor)::text from pg_auth_members m
 where m.roleid='dekez_collection_executor'::regrole and m.member=current_user::regrole
),'[]'),true);
do $safety$ begin
 if not exists(select 1 from pg_roles where rolname='dekez_collection_executor' and not rolcanlogin
  and not rolinherit and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls)
  or not exists(select 1 from pg_auth_members where roleid='dekez_collection_executor'::regrole
    and member=current_user::regrole and admin_option)
  or exists(select 1 from pg_auth_members where roleid='dekez_collection_executor'::regrole
    and member=current_user::regrole and (inherit_option or set_option)) then
  raise exception 'Expected restricted cleanup operator and executor required';
 end if;
 if (select count(*) from pg_proc p where p.oid in (
    'dekez_collections_private.setup_check(uuid,uuid,uuid)'::regprocedure,
    'dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text)'::regprocedure,
    'dekez_collections_private.setup_finish(uuid,uuid,uuid,text)'::regprocedure)
   and p.proowner='dekez_collection_executor'::regrole)<>3 then
  raise exception 'Unexpected setup function ownership';
 end if;
end $safety$;
update dekez_collections_private.callback_setup set revoked_at=clock_timestamp()
 where revoked_at is null;
revoke execute on function public.dekez_collection_setup_assert_admin(uuid,uuid) from service_role;
revoke execute on function public.dekez_collection_setup_check(uuid,uuid,uuid) from service_role;
revoke execute on function public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text) from service_role;
revoke execute on function public.dekez_collection_setup_finish(uuid,uuid,uuid,text) from service_role;
grant dekez_collection_executor to current_user with inherit false, set true;
set local role dekez_collection_executor;
revoke execute on function dekez_collections_private.setup_check(uuid,uuid,uuid) from service_role;
revoke execute on function dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text) from service_role;
revoke execute on function dekez_collections_private.setup_finish(uuid,uuid,uuid,text) from service_role;
reset role;
do $restore$ begin
 execute format('set local role %I',current_setting('dekez.callback_retire.operator'));
end $restore$;
grant dekez_collection_executor to current_user with inherit false, set false;
do $verify$ declare actual_memberships jsonb; begin
 if current_user<>current_setting('dekez.callback_retire.operator') then raise exception 'Cleanup operator changed'; end if;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.grantor),'[]'::jsonb) into actual_memberships from pg_auth_members m
  where m.roleid='dekez_collection_executor'::regrole and m.member=current_user::regrole;
 if actual_memberships is distinct from current_setting('dekez.callback_retire.memberships')::jsonb then
  raise exception 'Cleanup role memberships changed';
 end if;
 if exists(select 1 from unnest(array[
  'public.dekez_collection_setup_assert_admin(uuid,uuid)'::regprocedure,
  'public.dekez_collection_setup_check(uuid,uuid,uuid)'::regprocedure,
  'public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text)'::regprocedure,
  'public.dekez_collection_setup_finish(uuid,uuid,uuid,text)'::regprocedure,
  'dekez_collections_private.setup_check(uuid,uuid,uuid)'::regprocedure,
  'dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text)'::regprocedure,
  'dekez_collections_private.setup_finish(uuid,uuid,uuid,text)'::regprocedure
 ]) f cross join unnest(array['anon','authenticated','service_role']) r
 where has_function_privilege(r,f,'EXECUTE')) then raise exception 'Setup privileges remain'; end if;
end $verify$;
notify pgrst,'reload schema';
commit;
