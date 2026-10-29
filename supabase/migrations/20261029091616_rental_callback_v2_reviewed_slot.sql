-- REVIEW ONLY: allow one separately approved v2 setup slot after the known v1
-- preflight stopped without a provider write. Does not issue any authorization,
-- restore RPC access, change a function, send messages or modify business rows.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
lock table dekez_collections_private.callback_setup in access exclusive mode;

do $safety$ declare old_row jsonb; begin
 if not exists(select 1 from pg_roles where rolname='dekez_collection_executor' and not rolcanlogin
  and not rolinherit and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication and not rolbypassrls)
  or not exists(select 1 from pg_class where oid='dekez_collections_private.callback_setup'::regclass
   and relrowsecurity and relforcerowsecurity and relowner=current_user::regrole) then
  raise exception 'Expected private setup ownership and security required'; end if;
 if (select count(*) from dekez_collections_private.callback_setup)<>1 then
  raise exception 'Expected only the reviewed revoked v1 authorization'; end if;
 select to_jsonb(t) into old_row from dekez_collections_private.callback_setup t
 where id='5770722d-fb7a-4992-84aa-ef1186d24da9'::uuid
  and company_id='660cc0c4-daee-445b-9146-ccd112e791d4'::uuid
  and channel='FALCON-D9NS9' and operation_key='rental_callback_v1'
  and revoked_at is not null and consumed_at is null and before_hash is null and after_hash is null
  and deployment is null and outcome is null and finished_at is null;
 if old_row is null then raise exception 'Reviewed v1 must remain revoked and unused'; end if;
 perform set_config('dekez.callback_v2.previous',old_row::text,true);
 if not exists(select 1 from pg_constraint where conrelid='dekez_collections_private.callback_setup'::regclass
   and conname='callback_setup_operation_key_check' and contype='c' and convalidated
   and pg_get_constraintdef(oid)='CHECK ((operation_key = ''rental_callback_v1''::text))')
  or not exists(select 1 from pg_constraint where conrelid='dekez_collections_private.callback_setup'::regclass
   and contype='u' and pg_get_constraintdef(oid)='UNIQUE (company_id, operation_key)') then
  raise exception 'Unexpected setup operation constraint'; end if;
 if exists(select 1 from unnest(array[
  'public.dekez_collection_setup_assert_admin(uuid,uuid)'::regprocedure,
  'public.dekez_collection_setup_check(uuid,uuid,uuid)'::regprocedure,
  'public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text)'::regprocedure,
  'public.dekez_collection_setup_finish(uuid,uuid,uuid,text)'::regprocedure,
  'dekez_collections_private.setup_check(uuid,uuid,uuid)'::regprocedure,
  'dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text)'::regprocedure,
  'dekez_collections_private.setup_finish(uuid,uuid,uuid,text)'::regprocedure
 ]) f cross join unnest(array['anon','authenticated','service_role']) r
 where has_function_privilege(r,f,'EXECUTE')) then raise exception 'Setup must remain retired before v2 review'; end if;
 if exists(select 1 from unnest(array['anon','authenticated','service_role']) r
  where has_table_privilege(r,'dekez_collections_private.callback_setup','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
   or has_any_column_privilege(r,'dekez_collections_private.callback_setup','SELECT,INSERT,UPDATE,REFERENCES')) then
  raise exception 'Unexpected direct setup table access'; end if;
end $safety$;

alter table dekez_collections_private.callback_setup drop constraint callback_setup_operation_key_check;
alter table dekez_collections_private.callback_setup add constraint callback_setup_operation_key_check
 check(operation_key in ('rental_callback_v1','rental_callback_v2'));

do $verify$ begin
 if (select count(*) from dekez_collections_private.callback_setup)<>1
  or (select to_jsonb(t) from dekez_collections_private.callback_setup t
   where id='5770722d-fb7a-4992-84aa-ef1186d24da9'::uuid)
   is distinct from current_setting('dekez.callback_v2.previous')::jsonb then
  raise exception 'Original authorization changed'; end if;
end $verify$;
commit;
