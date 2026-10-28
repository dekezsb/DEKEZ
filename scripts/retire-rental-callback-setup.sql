-- REVIEW ONLY: cleanup after the separately approved temporary setup operation.
-- Run ONLY on explicit cleanup approval; retain the audit ledger. No sends.
begin;
set local lock_timeout='5s';
set local statement_timeout='15s';
update dekez_collections_private.callback_setup set revoked_at=clock_timestamp()
 where revoked_at is null;
revoke execute on function public.dekez_collection_setup_assert_admin(uuid,uuid) from service_role;
revoke execute on function public.dekez_collection_setup_check(uuid,uuid,uuid) from service_role;
revoke execute on function public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text) from service_role;
revoke execute on function public.dekez_collection_setup_finish(uuid,uuid,uuid,text) from service_role;
revoke execute on function dekez_collections_private.setup_check(uuid,uuid,uuid) from service_role;
revoke execute on function dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text) from service_role;
revoke execute on function dekez_collections_private.setup_finish(uuid,uuid,uuid,text) from service_role;
notify pgrst,'reload schema';
commit;
