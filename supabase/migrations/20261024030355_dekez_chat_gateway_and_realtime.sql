-- Separate rollout step: requires review/approval, then isolated gateway tests.
begin;
do $$ begin
 if not exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where v='pgrst.db_pre_request=marketplace_private.check_request')
 or exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) v where v like 'pgrst.db_pre_request=%' and v<>'pgrst.db_pre_request=marketplace_private.check_request') then raise exception 'Unexpected API guard; review before installing chat'; end if;
end $$;
create function dekez_chat_private.check_request() returns void language plpgsql security definer set search_path='' as $$
declare path text:=trim(both '/' from coalesce(current_setting('request.path',true),'')); method text:=coalesce(current_setting('request.method',true),'');
begin
 -- Only explicitly enumerated chat RPCs. No prefix-wide or table-wide bypass.
 if (dekez_chat_private.current_member() or dekez_chat_private.can_provision()) and (
 (method in ('GET','POST') and path=any(array['rpc/dekez_chat_inbox','rpc/dekez_chat_contacts','rpc/dekez_chat_detail','rpc/dekez_chat_history','rpc/dekez_chat_support_queue','rpc/dekez_chat_support_staff','rpc/dekez_chat_setup_options']))
 or (method='POST' and path=any(array['rpc/dekez_chat_open','rpc/dekez_chat_send','rpc/dekez_chat_read','rpc/dekez_chat_report','rpc/dekez_chat_evidence','rpc/dekez_chat_support_manifest','rpc/dekez_chat_support_assign','rpc/dekez_chat_support_status','rpc/dekez_chat_member_setup','rpc/dekez_chat_relationship_setup','rpc/dekez_chat_relationship_revoke','rpc/dekez_chat_file_reserve','rpc/dekez_chat_file_send','rpc/dekez_chat_files','rpc/dekez_chat_file_access']))
 ) then return; end if;
 perform marketplace_private.check_request();
end; $$;
grant usage on schema dekez_chat_private to anon;
revoke all on function dekez_chat_private.check_request() from public;
grant execute on function dekez_chat_private.check_request() to anon,authenticated,service_role;
alter role authenticator set pgrst.db_pre_request='dekez_chat_private.check_request';
-- Publish one small user-owned signal table only. Never publish all chat bodies.
do $$ begin
 if not exists(select 1 from pg_publication where pubname='supabase_realtime') then raise exception 'Realtime publication is missing; configure the test project first'; end if;
 if exists(select 1 from pg_publication where pubname='supabase_realtime' and puballtables) then raise exception 'Review broad realtime publication before enabling chat'; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='dekez_chat_signals') then alter publication supabase_realtime add table public.dekez_chat_signals; end if;
end $$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;
