-- Restricted, read-only pilot. No marketplace business or financial records.
alter type public.app_role add value if not exists 'contractor_preview';
create schema marketplace_private;
revoke all on schema marketplace_private from public, anon;
grant usage on schema marketplace_private to authenticated, service_role;

create function marketplace_private.is_preview() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and (
 exists(select 1 from public.profiles where id=auth.uid() and role='contractor_preview')
 or exists(select 1 from auth.users where id=auth.uid() and raw_app_meta_data->>'role'='contractor_preview'));
$$;
revoke all on function marketplace_private.is_preview() from public,anon;
grant execute on function marketplace_private.is_preview() to authenticated,service_role;

-- Preserve all existing policies. Add a restrictive boundary for this role only.
do $$ declare t record; begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where ((n.nspname='public' and c.relname<>'profiles') or (n.nspname='storage' and c.relname='objects'))
 and c.relkind in ('r','p') and c.relrowsecurity loop
 execute format('create policy contractor_preview_boundary on %I.%I as restrictive for all to authenticated using(not (select marketplace_private.is_preview())) with check(not (select marketplace_private.is_preview()))',t.nspname,t.relname);
 end loop;
end $$;
create policy contractor_preview_profile_read on public.profiles as restrictive for select to authenticated
 using(not (select marketplace_private.is_preview()) or id=(select auth.uid()));
create policy contractor_preview_profile_insert on public.profiles as restrictive for insert to authenticated
 with check(not (select marketplace_private.is_preview()));
create policy contractor_preview_profile_update on public.profiles as restrictive for update to authenticated
 using(not (select marketplace_private.is_preview())) with check(not (select marketplace_private.is_preview()));
create policy contractor_preview_profile_delete on public.profiles as restrictive for delete to authenticated
 using(not (select marketplace_private.is_preview()));

-- Chain, never replace or weaken, the current Owner boundary. This also blocks
-- legacy SECURITY DEFINER RPCs/views that table RLS cannot protect.
do $$ begin
 if not exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) v
 where v='pgrst.db_pre_request=owner_private.check_request')
 or exists(select 1 from pg_db_role_setting s cross join lateral unnest(s.setconfig) v
 where v like 'pgrst.db_pre_request=%' and v<>'pgrst.db_pre_request=owner_private.check_request')
 then raise exception 'Unexpected API guard: review before installing'; end if;
end $$;
create function marketplace_private.check_request() returns void
language plpgsql security definer set search_path='' as $$
declare p text:=trim(both '/' from coalesce(current_setting('request.path',true),''));
 m text:=coalesce(current_setting('request.method',true),'');
begin
 perform owner_private.check_request();
 if marketplace_private.is_preview() and not (p='profiles' and m in ('GET','HEAD'))
 then raise insufficient_privilege using message='Contractor preview access only'; end if;
end $$;
revoke all on function marketplace_private.check_request() from public;
grant usage on schema marketplace_private to anon;
grant execute on function marketplace_private.check_request() to anon,authenticated,service_role;
alter role authenticator set pgrst.db_pre_request='marketplace_private.check_request';

-- Reserve attempts BEFORE password verification, atomically. Five attempts per
-- fifteen-minute window, including successes. Existing login counters untouched.
create function public.contractor_preview_attempt(p_key text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare n integer; stamp timestamptz:=clock_timestamp();
begin
 if p_key !~ '^contractor-preview:[A-Za-z0-9_-]{43}$' then raise exception 'Invalid attempt key'; end if;
 insert into public.auth_login_rate_limits as r(phone_hash,failed_attempts,window_started_at,updated_at)
 values(p_key,1,stamp,stamp)
 on conflict(phone_hash) do update set
 failed_attempts=case when r.window_started_at<=stamp-interval '15 minutes' then 1 else least(r.failed_attempts+1,6) end,
 window_started_at=case when r.window_started_at<=stamp-interval '15 minutes' then stamp else r.window_started_at end,
 updated_at=stamp
 returning failed_attempts into n;
 return n<=5;
end $$;
revoke all on function public.contractor_preview_attempt(text) from public,anon,authenticated;
grant execute on function public.contractor_preview_attempt(text) to service_role;

-- Service-only finalization of a NEW banned pilot identity; never converts an
-- existing account. Collision checks and the profile/audit update are atomic.
create function marketplace_private.finalize_preview(p_id uuid,p_phone text) returns void
language plpgsql security definer set search_path='' as $$
declare digits text:=regexp_replace(p_phone,'[^0-9]','','g');
 local_phone text;
begin
 if p_phone !~ '^\+601[0-9]{8,9}$' then raise exception 'Invalid pilot phone'; end if;
 local_phone:='0'||substring(digits from 3);
 perform pg_advisory_xact_lock(hashtextextended('contractor-preview:'||digits,0));
 if not exists(select 1 from auth.users where id=p_id and raw_app_meta_data->>'role'='contractor_preview'
 and raw_app_meta_data->>'pilot_provisioning'='true' and created_at>now()-interval '15 minutes' and banned_until>now())
 then raise exception 'Only a new banned pilot identity can be finalized'; end if;
 if exists(select 1 from public.profiles where id<>p_id and regexp_replace(coalesce(phone,''),'[^0-9]','','g') in (digits,local_phone))
 or exists(select 1 from public.tenants where regexp_replace(coalesce(phone,''),'[^0-9]','','g') in (digits,local_phone))
 or exists(select 1 from auth.users where id<>p_id and regexp_replace(coalesce(phone,''),'[^0-9]','','g') in (digits,local_phone))
 then raise exception 'Phone already assigned; no existing record changed'; end if;
 update public.profiles set role='contractor_preview',global_role='contractor_preview',
 full_name='Contractor Test Preview',phone=p_phone,registration_status='approved',updated_at=now()
 where id=p_id and role='tenant';
 if not found then raise exception 'Pilot profile is not a new tenant-default profile'; end if;
 insert into public.audit_logs(action,entity_table,entity_id,metadata)
 values('contractor_preview_provisioned','profiles',p_id,jsonb_build_object('scope','read-only preview','source','explicit management approval','phone_verified',false));
end $$;
revoke all on function marketplace_private.finalize_preview(uuid,text) from public,anon,authenticated;
grant execute on function marketplace_private.finalize_preview(uuid,text) to service_role;
create function public.finalize_contractor_preview(p_id uuid,p_phone text) returns void
language sql security invoker set search_path='' as $$ select marketplace_private.finalize_preview(p_id,p_phone); $$;
revoke all on function public.finalize_contractor_preview(uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_contractor_preview(uuid,text) to service_role;
notify pgrst,'reload config';
notify pgrst,'reload schema';
