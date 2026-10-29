-- REVIEW ONLY. Separate explicit production approval is required for this script.
-- A trusted database operator must separately supply non-secret UUID settings:
-- dekez.callback_v2.actor = the approved, freshly verified executing Super Admin
-- dekez.callback_v2.operation = a fresh approved operation UUID (not the old v1).
-- No defaults, generated permit, browser input, public issuance RPC or reissue.
-- Run only when corrected deployed preflight is compatible and both sends are OFF.
-- After the single attempt (or any failure), run retire-rental-callback-setup.sql
-- and disable setup in a cleanup deployment. Never reset or delete either row.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table dekez_collections_private.callback_setup in exclusive mode;

do $prepare$ declare actor uuid; operation uuid; old_row jsonb; now_at timestamptz; begin
 actor:=nullif(current_setting('dekez.callback_v2.actor',true),'')::uuid;
 operation:=nullif(current_setting('dekez.callback_v2.operation',true),'')::uuid;
 if actor is null or operation is null or operation='5770722d-fb7a-4992-84aa-ef1186d24da9'::uuid then
  raise exception 'Explicit reviewed actor and fresh operation UUID required'; end if;
 if not exists(select 1 from pg_roles where rolname='dekez_collection_executor' and not rolcanlogin
  and not rolinherit and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls)
  or not exists(select 1 from pg_auth_members where roleid='dekez_collection_executor'::regrole
   and member=current_user::regrole and admin_option)
  or exists(select 1 from pg_auth_members where roleid='dekez_collection_executor'::regrole
   and member=current_user::regrole and (inherit_option or set_option)) then
  raise exception 'Expected restricted operator and executor required'; end if;
 if not exists(select 1 from pg_class where oid='dekez_collections_private.callback_setup'::regclass
   and relrowsecurity and relforcerowsecurity and relowner=current_user::regrole)
  or (select count(*) from pg_proc where oid in (
   'dekez_collections_private.setup_check(uuid,uuid,uuid)'::regprocedure,
   'dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text)'::regprocedure,
   'dekez_collections_private.setup_finish(uuid,uuid,uuid,text)'::regprocedure)
   and proowner='dekez_collection_executor'::regrole)<>3 then
  raise exception 'Unexpected private setup ownership or security'; end if;
 if exists(select 1 from unnest(array[
  'public.dekez_collection_setup_assert_admin(uuid,uuid)'::regprocedure,
  'public.dekez_collection_setup_check(uuid,uuid,uuid)'::regprocedure,
  'public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text)'::regprocedure,
  'public.dekez_collection_setup_finish(uuid,uuid,uuid,text)'::regprocedure,
  'dekez_collections_private.setup_check(uuid,uuid,uuid)'::regprocedure,
  'dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text)'::regprocedure,
  'dekez_collections_private.setup_finish(uuid,uuid,uuid,text)'::regprocedure
 ]) f cross join unnest(array['anon','authenticated','service_role']) r
 where has_function_privilege(r,f,'EXECUTE')) then raise exception 'Setup must be retired before authorization'; end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_table_privilege(r,'dekez_collections_private.callback_setup','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   or has_any_column_privilege(r,'dekez_collections_private.callback_setup','SELECT,INSERT,UPDATE,REFERENCES')) then
  raise exception 'Unexpected direct setup table access'; end if;
 if (select count(*) from dekez_collections_private.callback_setup)<>1 then
  raise exception 'One v2 lifetime authorization only; no reset or reissue'; end if;
 select to_jsonb(t) into old_row from dekez_collections_private.callback_setup t
 where id='5770722d-fb7a-4992-84aa-ef1186d24da9'::uuid
  and company_id='660cc0c4-daee-445b-9146-ccd112e791d4'::uuid and channel='FALCON-D9NS9'
  and operation_key='rental_callback_v1' and revoked_at is not null and consumed_at is null
  and before_hash is null and after_hash is null and deployment is null and outcome is null and finished_at is null;
 if old_row is null then raise exception 'Reviewed v1 must remain revoked and unused'; end if;
 -- Lock fresh identity/membership while issuing; runtime independently rechecks
 -- them on every preview/claim and again after row-lock waits.
 perform 1 from public.profiles where id=actor and role::text='super_admin'
  and registration_status='approved' for share;
 if not found then raise exception 'Fresh approved Super Admin required'; end if;
 perform 1 from public.company_users where company_id='660cc0c4-daee-445b-9146-ccd112e791d4'::uuid
  and user_id=actor and profile_id=actor and role::text='super_admin' and status='active' for share;
 if not found or exists(select 1 from public.user_module_permissions where profile_id=actor
  and module_key='admin_setup' and access_level::text is distinct from 'manage') then
  raise exception 'Fresh approved company and module access required'; end if;
 perform set_config('dekez.callback_v2.previous',old_row::text,true);
 perform set_config('dekez.callback_v2.operator',current_user,true);
 perform set_config('dekez.callback_v2.memberships',coalesce((select jsonb_agg(to_jsonb(m) order by m.grantor)::text
  from pg_auth_members m where m.roleid='dekez_collection_executor'::regrole and m.member=current_user::regrole),'[]'),true);
 -- Exactly one database clock; fixed ten-minute lifetime, below the 15-minute cap.
 now_at:=clock_timestamp();
 insert into dekez_collections_private.callback_setup
  (id,company_id,channel,operation_key,approved_actor,created_at,expires_at)
 values(operation,'660cc0c4-daee-445b-9146-ccd112e791d4','FALCON-D9NS9','rental_callback_v2',actor,now_at,now_at+interval '10 minutes');
end $prepare$;

grant execute on function public.dekez_collection_setup_assert_admin(uuid,uuid) to service_role;
grant execute on function public.dekez_collection_setup_check(uuid,uuid,uuid) to service_role;
grant execute on function public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function public.dekez_collection_setup_finish(uuid,uuid,uuid,text) to service_role;
grant dekez_collection_executor to current_user with inherit false, set true;
set local role dekez_collection_executor;
grant execute on function dekez_collections_private.setup_check(uuid,uuid,uuid) to service_role;
grant execute on function dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text) to service_role;
grant execute on function dekez_collections_private.setup_finish(uuid,uuid,uuid,text) to service_role;
reset role;
do $restore$ begin
 execute format('set local role %I',current_setting('dekez.callback_v2.operator'));
end $restore$;
grant dekez_collection_executor to current_user with inherit false, set false;

do $verify$ declare memberships jsonb; begin
 select coalesce(jsonb_agg(to_jsonb(m) order by m.grantor),'[]'::jsonb) into memberships from pg_auth_members m
  where m.roleid='dekez_collection_executor'::regrole and m.member=current_user::regrole;
 if current_user<>current_setting('dekez.callback_v2.operator')
  or memberships is distinct from current_setting('dekez.callback_v2.memberships')::jsonb then
  raise exception 'Operator privileges changed'; end if;
 if (select to_jsonb(t) from dekez_collections_private.callback_setup t
   where id='5770722d-fb7a-4992-84aa-ef1186d24da9'::uuid)
  is distinct from current_setting('dekez.callback_v2.previous')::jsonb then
  raise exception 'Original authorization changed'; end if;
 if exists(select 1 from unnest(array[
  'public.dekez_collection_setup_assert_admin(uuid,uuid)'::regprocedure,
  'public.dekez_collection_setup_check(uuid,uuid,uuid)'::regprocedure,
  'public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text)'::regprocedure,
  'public.dekez_collection_setup_finish(uuid,uuid,uuid,text)'::regprocedure,
  'dekez_collections_private.setup_check(uuid,uuid,uuid)'::regprocedure,
  'dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text)'::regprocedure,
  'dekez_collections_private.setup_finish(uuid,uuid,uuid,text)'::regprocedure
 ]) f cross join unnest(array['anon','authenticated','service_role']) r
 where has_function_privilege(r,f,'EXECUTE') is distinct from (r='service_role')) then
  raise exception 'Unexpected setup privileges'; end if;
end $verify$;
notify pgrst,'reload schema';
commit;
