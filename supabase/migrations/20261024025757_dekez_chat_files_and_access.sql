-- Staged only. Additive DEKEZ chat controls; never changes accounts or accounting.
begin;
create function dekez_chat_private.in_company(p_user uuid,p_company uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.company_users cu where cu.company_id=p_company and coalesce(cu.profile_id,cu.user_id)=p_user and cu.status::text='active');
$$;
create function dekez_chat_private.account_company(p_user uuid,p_company uuid) returns boolean language sql stable security definer set search_path='' as $$
 select dekez_chat_private.in_company(p_user,p_company)
 or exists(select 1 from public.property_owners o join public.properties p on p.id=o.property_id where o.owner_id=p_user and p.company_id=p_company and o.start_date<=current_date and (o.end_date is null or o.end_date>=current_date))
 or exists(select 1 from public.tenancies t join public.tenants tenant on tenant.id=t.tenant_id join public.properties p on p.id=t.property_id where tenant.profile_id=p_user and p.company_id=p_company and t.status::text='active')
 or exists(select 1 from public.maintenance_ticket_assignments a join public.maintenance_tickets t on t.id=a.ticket_id join public.properties p on p.id=t.property_id where a.assigned_to=p_user and p.company_id=p_company and a.status in ('assigned','accepted') and t.status::text in ('submitted','assigned','in_progress','waiting_for_parts'));
$$;
create function dekez_chat_private.can_provision() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles where id=auth.uid() and role::text='super_admin' and registration_status='approved');
$$;
create function dekez_chat_private.member_setup(p_user uuid,p_enabled boolean,p_support boolean,p_dispatch boolean,p_preview_ack boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare p public.profiles; mapped text; previous jsonb;
begin
 if not dekez_chat_private.can_provision() then raise insufficient_privilege; end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 or p_enabled is null or p_support is null or p_dispatch is null then raise exception 'An access reason is required.'; end if;
 select * into p from public.profiles where id=p_user for share;
 if not found or p.registration_status<>'approved' or not exists(select 1 from public.company_users cu where coalesce(cu.profile_id,cu.user_id)=auth.uid() and cu.status::text='active' and dekez_chat_private.account_company(p_user,cu.company_id)) then raise insufficient_privilege using message='Account has no authorized company relationship or is not approved.'; end if;
 mapped:=case when p.role::text in ('owner','client_owner') then 'owner' when p.role::text='tenant' then 'tenant'
 when p.role::text in ('admin','admin_team') then 'management' when p.role::text='super_admin' then 'admin'
 when p.role::text in ('technician','technician_team','maintenance_staff','cleaning_staff') then 'staff'
 when p.role::text='contractor_preview' then 'contractor' end;
 if mapped is null or (mapped='contractor' and p_enabled and not coalesce(p_preview_ack,false))
 or (p_support and mapped not in ('admin','management','staff')) or (p_dispatch and mapped not in ('admin','management')) then raise exception 'Invalid chat capability or missing contractor acknowledgement.'; end if;
 select to_jsonb(m) into previous from dekez_chat_private.members m where user_id=p_user;
 insert into dekez_chat_private.members(user_id,profile_role,chat_role,enabled,support_enabled,support_dispatcher,approved_by)
 values(p_user,p.role::text,mapped,p_enabled,p_support,p_dispatch,auth.uid()) on conflict(user_id) do update
 set profile_role=excluded.profile_role,chat_role=excluded.chat_role,enabled=excluded.enabled,support_enabled=excluded.support_enabled,support_dispatcher=excluded.support_dispatcher,approved_by=auth.uid(),approved_at=now();
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(auth.uid(),'chat_member_setup',p_user,
 jsonb_build_object('previous',previous,'enabled',p_enabled,'support',p_support,'dispatch',p_dispatch,'preview_ack',p_preview_ack,'reason',trim(p_reason))::text);
end; $$;

-- Current business sources, not a caller-selected role or permanent contact list.
create function dekez_chat_private.source_authorized(p_user uuid,p_property uuid,p_room uuid,p_tenancy uuid,p_ticket uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from dekez_chat_private.members m join public.profiles u on u.id=m.user_id
 join public.properties p on p.id=p_property where m.user_id=p_user and m.enabled and u.role::text=m.profile_role and u.registration_status='approved'
 and (p_room is null or exists(select 1 from public.rooms r where r.id=p_room and r.property_id=p.id))
 and (p_tenancy is null or exists(select 1 from public.tenancies t where t.id=p_tenancy and t.property_id=p.id and (p_room is null or t.room_id=p_room)))
 and (p_ticket is null or exists(select 1 from public.maintenance_tickets t where t.id=p_ticket and t.property_id=p.id and (p_room is null or t.room_id=p_room)))
 and case m.chat_role
 when 'owner' then exists(select 1 from public.property_owners o where o.owner_id=p_user and o.property_id=p.id and o.start_date<=current_date and (o.end_date is null or o.end_date>=current_date))
 and (m.profile_role<>'client_owner' or exists(select 1 from public.client_owner_settings s where s.owner_id=p_user and s.enabled))
 when 'tenant' then exists(select 1 from public.tenancies t join public.tenants tenant on tenant.id=t.tenant_id
 where tenant.profile_id=p_user and t.property_id=p.id and t.status::text='active'
 and (p_tenancy is null or t.id=p_tenancy) and (p_room is null or t.room_id=p_room)
 and (p_ticket is null or exists(select 1 from public.maintenance_tickets ticket where ticket.id=p_ticket and ticket.tenant_id=tenant.id and ticket.room_id=t.room_id)))
 when 'contractor' then p_ticket is not null and exists(select 1 from public.maintenance_ticket_assignments a
 join public.maintenance_tickets t on t.id=a.ticket_id where a.assigned_to=p_user and a.ticket_id=p_ticket and a.status in ('assigned','accepted')
 and t.status::text in ('submitted','assigned','in_progress','waiting_for_parts'))
 else exists(select 1 from public.company_users cu where cu.company_id=p.company_id and coalesce(cu.profile_id,cu.user_id)=p_user and cu.status::text='active') end);
$$;
-- Keep the original job/role/expiry checks and add source-of-truth checks.
alter function dekez_chat_private.can_start(uuid) rename to grant_is_active;
create function dekez_chat_private.can_start(p_relationship uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select dekez_chat_private.grant_is_active(p_relationship) and exists(select 1 from dekez_chat_private.relationships r
 join dekez_chat_private.scopes s on s.id=r.scope_id where r.id=p_relationship
 and dekez_chat_private.source_authorized(r.user_a,s.property_id,s.room_id,s.tenancy_id,s.maintenance_ticket_id)
 and dekez_chat_private.source_authorized(r.user_b,s.property_id,s.room_id,s.tenancy_id,s.maintenance_ticket_id));
$$;
create function dekez_chat_private.relationship_setup(p_a uuid,p_b uuid,p_property uuid,p_room uuid,p_tenancy uuid,p_ticket uuid,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare scope uuid; result uuid; a text; b text;
begin
 if not dekez_chat_private.can_provision() then raise insufficient_privilege; end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 or p_a=p_b then raise exception 'Invalid relationship request.'; end if;
 if not exists(select 1 from public.properties p where p.id=p_property and dekez_chat_private.in_company(auth.uid(),p.company_id)) then raise insufficient_privilege; end if;
 if p_ticket is not null then
 perform 1 from public.maintenance_tickets where id=p_ticket and property_id=p_property and status::text in ('submitted','assigned','in_progress','waiting_for_parts') for share;
 if not found then raise insufficient_privilege using message='This job is not active.'; end if;
 perform 1 from public.maintenance_ticket_assignments where ticket_id=p_ticket for share;
 end if;
 select chat_role into a from dekez_chat_private.members where user_id=p_a;
 select chat_role into b from dekez_chat_private.members where user_id=p_b;
 if a is null or b is null or (a='owner' and b='tenant' or a='tenant' and b='owner') then raise insufficient_privilege using message='Direct Owner–Tenant messaging is not permitted.'; end if;
 if not (a in ('admin','management') or b in ('admin','management') or a='contractor' and b in ('owner','tenant') or b='contractor' and a in ('owner','tenant')) then raise insufficient_privilege; end if;
 if not dekez_chat_private.source_authorized(p_a,p_property,p_room,p_tenancy,p_ticket) or not dekez_chat_private.source_authorized(p_b,p_property,p_room,p_tenancy,p_ticket) then raise insufficient_privilege using message='The property or active job relationship is not authorized.'; end if;
 perform pg_advisory_xact_lock(hashtextextended('dekez-chat-scope:'||p_property::text||coalesce(p_ticket::text,'')||coalesce(p_room::text,'')||coalesce(p_tenancy::text,''),0));
 select id into scope from dekez_chat_private.scopes where property_id=p_property and room_id is not distinct from p_room and tenancy_id is not distinct from p_tenancy and maintenance_ticket_id is not distinct from p_ticket;
 if scope is null then
 insert into dekez_chat_private.scopes(kind,property_id,room_id,tenancy_id,maintenance_ticket_id) values(case when p_ticket is null then 'property' else 'maintenance' end,p_property,p_room,p_tenancy,p_ticket) returning id into scope; end if;
 if exists(select 1 from dekez_chat_private.scopes where id=scope and closed_at is not null) then raise insufficient_privilege using message='Use a new job; closed chat scopes cannot reopen.'; end if;
 insert into dekez_chat_private.relationships(scope_id,user_a,user_b,authorized_by,reason) values(scope,least(p_a,p_b),greatest(p_a,p_b),auth.uid(),trim(p_reason)) on conflict(scope_id,user_a,user_b) do nothing;
 select id into result from dekez_chat_private.relationships where scope_id=scope and user_a=least(p_a,p_b) and user_b=greatest(p_a,p_b) and status='active';
 if result is null then raise insufficient_privilege using message='Ended relationships cannot reopen.'; end if;
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(auth.uid(),'chat_relationship_authorized',result,trim(p_reason));
 return result;
end; $$;
create function dekez_chat_private.relationship_revoke(p_relationship uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not dekez_chat_private.can_provision() or p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise insufficient_privilege; end if;
 if not exists(select 1 from dekez_chat_private.relationships r join dekez_chat_private.scopes s on s.id=r.scope_id join public.properties p on p.id=s.property_id where r.id=p_relationship and dekez_chat_private.in_company(auth.uid(),p.company_id)) then raise insufficient_privilege; end if;
 update dekez_chat_private.relationships set status='revoked' where id=p_relationship;
 update public.dekez_conversations set status='closed',closed_at=coalesce(closed_at,now()) where relationship_id=p_relationship;
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(auth.uid(),'chat_relationship_revoked',p_relationship,trim(p_reason));
end; $$;

-- File reservation is private; only the server can attest uploaded bytes.
create table dekez_chat_private.uploads (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.dekez_conversations(id),
 user_id uuid not null references public.profiles(id), client_key uuid not null, digest text not null check(digest ~ '^[0-9a-f]{64}$'),
 file_name text not null check(length(file_name) between 1 and 255), mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
 byte_size integer not null check(byte_size between 1 and 3145728), object_key text not null unique,
 ready boolean not null default false, message_id uuid references public.dekez_messages(id), created_at timestamptz not null default now(),
 unique(user_id,client_key)
);
alter table dekez_chat_private.uploads enable row level security;
revoke all on dekez_chat_private.uploads from public,anon,authenticated;
create index dekez_chat_upload_limit on dekez_chat_private.uploads(user_id,created_at desc);
create function dekez_chat_private.file_reserve(p_conversation uuid,p_key uuid,p_digest text,p_name text,p_mime text,p_size integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u dekez_chat_private.uploads;
begin
 if not dekez_chat_private.can_read(p_conversation) or not exists(select 1 from public.dekez_conversations c where c.id=p_conversation and c.status='active' and dekez_chat_private.can_start(c.relationship_id)) then raise insufficient_privilege; end if;
 perform 1 from dekez_chat_private.members where user_id=auth.uid() for update;
 select * into u from dekez_chat_private.uploads where user_id=auth.uid() and client_key=p_key;
 if found then
 if u.conversation_id<>p_conversation or u.digest<>p_digest or u.file_name<>p_name or u.mime_type<>p_mime or u.byte_size<>p_size then raise exception 'Upload retry does not match.'; end if;
 else
 if (select count(*) from dekez_chat_private.uploads where user_id=auth.uid() and created_at>now()-interval '1 hour')>=30 then raise exception 'Please wait before uploading more files.'; end if;
 insert into dekez_chat_private.uploads(conversation_id,user_id,client_key,digest,file_name,mime_type,byte_size,object_key)
 values(p_conversation,auth.uid(),p_key,p_digest,p_name,p_mime,p_size,p_conversation::text||'/'||gen_random_uuid()::text) returning * into u;
 end if;
 return jsonb_build_object('id',u.id,'object_key',u.object_key,'ready',u.ready);
end; $$;
create function dekez_chat_private.file_uploaded(p_upload uuid,p_digest text) returns void
language plpgsql security definer set search_path='' as $$
begin
 update dekez_chat_private.uploads set ready=true where id=p_upload and digest=p_digest;
 if not found then raise exception 'Upload attestation mismatch.'; end if;
end; $$;
create function dekez_chat_private.file_send(p_upload uuid,p_body text) returns public.dekez_messages
language plpgsql security definer set search_path='' as $$
declare u dekez_chat_private.uploads; m public.dekez_messages; ticket uuid;
begin
 -- Use send()'s lock order before checking retries. A file must never be added
 -- retroactively to a previously sent text message that reused the same key.
 select * into u from dekez_chat_private.uploads where id=p_upload and user_id=auth.uid() and ready;
 if not found then raise insufficient_privilege; end if;
 select s.maintenance_ticket_id into ticket from public.dekez_conversations c
 join dekez_chat_private.relationships r on r.id=c.relationship_id join dekez_chat_private.scopes s on s.id=r.scope_id where c.id=u.conversation_id;
 if ticket is not null then
 perform 1 from public.maintenance_tickets where id=ticket for share;
 perform 1 from public.maintenance_ticket_assignments where ticket_id=ticket for share;
 end if;
 perform 1 from dekez_chat_private.relationships where id=(select relationship_id from public.dekez_conversations where id=u.conversation_id) for share;
 perform 1 from public.dekez_conversations where id=u.conversation_id for update;
 select * into u from dekez_chat_private.uploads where id=p_upload for update;
 select * into m from public.dekez_messages where conversation_id=u.conversation_id and sender_id=auth.uid() and client_key=u.client_key;
 if found and u.message_id is distinct from m.id then raise exception 'Upload key already belongs to another message.'; end if;
 m:=dekez_chat_private.send(u.conversation_id,p_body,u.client_key);
 insert into public.dekez_message_attachments(id,message_id,file_name,mime_type,byte_size,object_key)
 values(u.id,m.id,u.file_name,u.mime_type,u.byte_size,u.object_key) on conflict(id) do nothing;
 update dekez_chat_private.uploads set message_id=m.id where id=u.id;
 return m;
end; $$;
create function dekez_chat_private.files(p_conversation uuid,p_messages uuid[]) returns table(id uuid,message_id uuid,file_name text,mime_type text,byte_size bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege; end if;
 if cardinality(p_messages)>50 then raise exception 'Request up to 50 messages.'; end if;
 return query select a.id,a.message_id,a.file_name,a.mime_type,a.byte_size from public.dekez_message_attachments a join public.dekez_messages m on m.id=a.message_id where m.conversation_id=p_conversation and m.id=any(p_messages);
end; $$;
create function dekez_chat_private.file_access(p_attachment uuid,p_case uuid,p_reason text,p_intent text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.dekez_message_attachments; conv uuid;
begin
 if p_intent is null or p_intent not in ('view','download') then raise exception 'Invalid file action.'; end if;
 select * into a from public.dekez_message_attachments where id=p_attachment;
 if not found then raise insufficient_privilege; end if;
 select conversation_id into conv from public.dekez_messages where id=a.message_id;
 if p_case is null then
 if not dekez_chat_private.can_read(conv) then raise insufficient_privilege; end if;
 else
 perform 1 from public.dekez_support_cases where id=p_case for share;
 if not dekez_chat_private.support_allowed(p_case) or not exists(select 1 from dekez_chat_private.support_attachment_evidence where case_id=p_case and attachment_id=a.id)
 or p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise insufficient_privilege; end if;
 end if;
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(auth.uid(),case when p_case is null then 'chat_file_' else 'support_file_' end||p_intent,a.id,case when p_case is null then null else p_case::text||': '||trim(p_reason) end);
 return jsonb_build_object('object_key',a.object_key,'file_name',a.file_name,'mime_type',a.mime_type,'byte_size',a.byte_size);
end; $$;
alter function dekez_chat_private.support_manifest(uuid,text) rename to message_manifest;
create function dekez_chat_private.support_manifest(p_case uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=dekez_chat_private.message_manifest(p_case,p_reason);
 return result||jsonb_build_object('attachments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'message_id',a.message_id,'file_name',a.file_name,'mime_type',a.mime_type,'byte_size',a.byte_size)) from dekez_chat_private.support_attachment_evidence e join public.dekez_message_attachments a on a.id=e.attachment_id where e.case_id=p_case),'[]'::jsonb));
end; $$;
-- Recreate wrappers after renames so cached SQL dependencies cannot use old functions.
create or replace function public.dekez_chat_support_manifest(p_case uuid,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select dekez_chat_private.support_manifest(p_case,p_reason)$$;
create function public.dekez_chat_member_setup(p_user uuid,p_enabled boolean,p_support boolean,p_dispatch boolean,p_preview_ack boolean,p_reason text) returns void language sql security invoker set search_path='' as $$select dekez_chat_private.member_setup(p_user,p_enabled,p_support,p_dispatch,p_preview_ack,p_reason)$$;
create function public.dekez_chat_relationship_setup(p_a uuid,p_b uuid,p_property uuid,p_room uuid,p_tenancy uuid,p_ticket uuid,p_reason text) returns uuid language sql security invoker set search_path='' as $$select dekez_chat_private.relationship_setup(p_a,p_b,p_property,p_room,p_tenancy,p_ticket,p_reason)$$;
create function public.dekez_chat_relationship_revoke(p_relationship uuid,p_reason text) returns void language sql security invoker set search_path='' as $$select dekez_chat_private.relationship_revoke(p_relationship,p_reason)$$;
create function public.dekez_chat_file_reserve(p_conversation uuid,p_key uuid,p_digest text,p_name text,p_mime text,p_size integer) returns jsonb language sql security invoker set search_path='' as $$select dekez_chat_private.file_reserve(p_conversation,p_key,p_digest,p_name,p_mime,p_size)$$;
create function public.dekez_chat_file_uploaded(p_upload uuid,p_digest text) returns void language sql security invoker set search_path='' as $$select dekez_chat_private.file_uploaded(p_upload,p_digest)$$;
create function public.dekez_chat_file_send(p_upload uuid,p_body text) returns public.dekez_messages language sql security invoker set search_path='' as $$select dekez_chat_private.file_send(p_upload,p_body)$$;
create function public.dekez_chat_files(p_conversation uuid,p_messages uuid[]) returns table(id uuid,message_id uuid,file_name text,mime_type text,byte_size bigint) language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.files(p_conversation,p_messages)$$;
create function public.dekez_chat_file_access(p_attachment uuid,p_case uuid,p_reason text,p_intent text) returns jsonb language sql security invoker set search_path='' as $$select dekez_chat_private.file_access(p_attachment,p_case,p_reason,p_intent)$$;

create function dekez_chat_private.setup_options(p_kind text,p_property uuid,p_after uuid) returns table(id uuid,label text,enabled boolean,support boolean,dispatch boolean)
language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.can_provision() then raise insufficient_privilege; end if;
 if p_kind='accounts' then
 return query select p.id,coalesce(nullif(p.full_name,''),'Account')||' · '||p.role::text,coalesce(m.enabled,false),coalesce(m.support_enabled,false),coalesce(m.support_dispatcher,false)
 from public.profiles p left join dekez_chat_private.members m on m.user_id=p.id
 where p.registration_status='approved' and exists(select 1 from public.company_users cu where coalesce(cu.profile_id,cu.user_id)=auth.uid() and cu.status::text='active' and dekez_chat_private.account_company(p.id,cu.company_id)) and (p_after is null or p.id>p_after) order by p.id limit 25;
 elsif p_kind='properties' then
 return query select p.id,p.name,false,false,false from public.properties p where dekez_chat_private.in_company(auth.uid(),p.company_id) and (p_after is null or p.id>p_after) order by p.id limit 25;
 elsif p_kind='jobs' then
 return query select t.id,coalesce(t.ticket_number,t.id::text)||' · '||t.status::text,false,false,false from public.maintenance_tickets t
 join public.properties p on p.id=t.property_id
 where dekez_chat_private.in_company(auth.uid(),p.company_id) and t.property_id=p_property and t.status::text in ('submitted','assigned','in_progress','waiting_for_parts') and (p_after is null or t.id>p_after) order by t.id limit 25;
 else raise exception 'Invalid setup list.'; end if;
end; $$;
create function public.dekez_chat_setup_options(p_kind text,p_property uuid default null,p_after uuid default null) returns table(id uuid,label text,enabled boolean,support boolean,dispatch boolean)
language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.setup_options(p_kind,p_property,p_after)$$;

create function dekez_chat_private.case_in_company(p_case uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.dekez_support_cases c join public.dekez_conversations v on v.id=c.conversation_id
 join dekez_chat_private.relationships r on r.id=v.relationship_id join dekez_chat_private.scopes s on s.id=r.scope_id
 join public.properties p on p.id=s.property_id
 where c.id=p_case and dekez_chat_private.in_company(auth.uid(),p.company_id));
$$;
alter function dekez_chat_private.support_allowed(uuid) rename to support_grant_valid;
create function dekez_chat_private.support_allowed(p_case uuid) returns boolean language sql stable security definer set search_path='' as $$
 select dekez_chat_private.case_in_company(p_case) and dekez_chat_private.support_grant_valid(p_case);
$$;
alter function dekez_chat_private.support_assign(uuid,uuid,integer,text) rename to assign_case;
create function dekez_chat_private.support_assign(p_case uuid,p_staff uuid,p_minutes integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not dekez_chat_private.case_in_company(p_case) or not exists(select 1 from public.dekez_support_cases c join public.dekez_conversations v on v.id=c.conversation_id join dekez_chat_private.relationships r on r.id=v.relationship_id join dekez_chat_private.scopes s on s.id=r.scope_id join public.properties p on p.id=s.property_id where c.id=p_case and dekez_chat_private.in_company(p_staff,p.company_id)) then raise insufficient_privilege; end if;
 perform dekez_chat_private.assign_case(p_case,p_staff,p_minutes,p_reason);
end; $$;
alter function dekez_chat_private.support_status(uuid,text,text) rename to change_case_status;
create function dekez_chat_private.support_status(p_case uuid,p_status text,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not dekez_chat_private.case_in_company(p_case) then raise insufficient_privilege; end if;
 perform dekez_chat_private.change_case_status(p_case,p_status,p_reason);
end; $$;
create or replace function public.dekez_chat_support_assign(p_case uuid,p_staff uuid,p_minutes integer,p_reason text) returns void language sql security invoker set search_path='' as $$select dekez_chat_private.support_assign(p_case,p_staff,p_minutes,p_reason)$$;
create or replace function public.dekez_chat_support_status(p_case uuid,p_status text,p_reason text) returns void language sql security invoker set search_path='' as $$select dekez_chat_private.support_status(p_case,p_status,p_reason)$$;
create or replace function dekez_chat_private.support_queue(p_before timestamptz,p_before_id uuid,p_limit integer)
returns table(case_id uuid,conversation_id uuid,reported_by uuid,reason text,status text,assigned_to uuid,access_until timestamptz,created_at timestamptz,maintenance_ticket_id uuid,can_dispatch boolean)
language plpgsql stable security definer set search_path='' as $$
declare dispatcher boolean:=dekez_chat_private.can_dispatch();
begin
 if not dekez_chat_private.current_member() or not (dispatcher or exists(select 1 from dekez_chat_private.members where user_id=auth.uid() and support_enabled and chat_role in ('admin','management','staff'))) then raise insufficient_privilege; end if;
 return query select c.id,c.conversation_id,c.reported_by,c.reason,c.status,c.assigned_to,c.access_until,c.created_at,s.maintenance_ticket_id,dispatcher
 from public.dekez_support_cases c join public.dekez_conversations v on v.id=c.conversation_id join dekez_chat_private.relationships r on r.id=v.relationship_id join dekez_chat_private.scopes s on s.id=r.scope_id
 where dekez_chat_private.case_in_company(c.id) and (dispatcher or c.assigned_to=auth.uid()) and (p_before is null or (c.created_at,c.id)<(p_before,p_before_id))
 order by c.created_at desc,c.id desc limit greatest(1,least(coalesce(p_limit,25),50));
end; $$;
create or replace function dekez_chat_private.support_staff(p_after uuid,p_limit integer)
returns table(user_id uuid,display_name text) language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.can_dispatch() then raise insufficient_privilege; end if;
 return query select m.user_id,coalesce(nullif(p.full_name,''),'Authorized support staff') from dekez_chat_private.members m join public.profiles p on p.id=m.user_id
 where exists(select 1 from public.company_users cu where coalesce(cu.profile_id,cu.user_id)=auth.uid() and cu.status::text='active' and dekez_chat_private.in_company(m.user_id,cu.company_id)) and m.enabled and m.support_enabled and m.chat_role in ('admin','management','staff') and p.role::text=m.profile_role and p.registration_status='approved' and (p_after is null or m.user_id>p_after) order by m.user_id limit greatest(1,least(coalesce(p_limit,25),50));
end; $$;

-- Retry identical support requests safely; bound report bursts separately from chat.
create index dekez_chat_report_rate on public.dekez_support_cases(reported_by,created_at desc);
alter function dekez_chat_private.report(uuid,text,text,uuid[],uuid[]) rename to create_report;
create function dekez_chat_private.report(p_conversation uuid,p_reason text,p_explanation text,p_messages uuid[],p_attachments uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare existing uuid;
begin
 if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege; end if;
 if coalesce(cardinality(p_messages),0)>50 or coalesce(cardinality(p_attachments),0)>50 then raise exception 'Select up to 50 evidence items.'; end if;
 perform 1 from dekez_chat_private.members where user_id=auth.uid() for update;
 select c.id into existing from public.dekez_support_cases c where c.reported_by=auth.uid() and c.conversation_id=p_conversation
 and c.reason=p_reason and c.explanation=p_explanation and c.status in ('open','under_review','waiting_for_response') and c.created_at>now()-interval '10 minutes'
 and array(select distinct unnest(p_messages) order by 1)=array(select message_id from dekez_chat_private.support_evidence where case_id=c.id order by message_id)
 and array(select distinct unnest(p_attachments) order by 1)=array(select attachment_id from dekez_chat_private.support_attachment_evidence where case_id=c.id order by attachment_id) limit 1;
 if existing is not null then return existing; end if;
 if (select count(*) from public.dekez_support_cases where reported_by=auth.uid() and created_at>now()-interval '1 hour')>=10 then raise exception 'Please wait before submitting another report.'; end if;
 return dekez_chat_private.create_report(p_conversation,p_reason,p_explanation,p_messages,p_attachments);
end; $$;
create or replace function public.dekez_chat_report(p_conversation uuid,p_reason text,p_explanation text,p_messages uuid[],p_attachments uuid[]) returns uuid language sql security invoker set search_path='' as $$select dekez_chat_private.report(p_conversation,p_reason,p_explanation,p_messages,p_attachments)$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dekez_chat_private' or n.nspname='public' and p.proname like 'dekez_chat_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname in ('file_uploaded','dekez_chat_file_uploaded') then execute format('grant execute on function %s to service_role',f.signature);
 elsif f.proname not in ('close_ticket_chats','close_assignment_chats','create_report','assign_case','change_case_status','source_authorized','grant_is_active','case_in_company','support_grant_valid','message_manifest','in_company','account_company') then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
grant usage on schema dekez_chat_private to service_role;
-- No SELECT grant on private tables, including to support staff.
-- Dedicated private bucket; restrictive guard defeats legacy permissive policies
-- only for this bucket, leaving every existing Storage object/policy untouched.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('dekez-chat-files','dekez-chat-files',false,3145728,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy dekez_chat_files_server_only on storage.objects as restrictive for all to anon,authenticated
using(bucket_id<>'dekez-chat-files') with check(bucket_id<>'dekez-chat-files');

-- Realtime contains only a caller-specific invalidation counter, never messages,
-- names, file keys or other people's conversation IDs.
create table public.dekez_chat_signals(user_id uuid primary key references public.profiles(id),revision bigint not null default 1,updated_at timestamptz not null default clock_timestamp());
alter table public.dekez_chat_signals enable row level security;
revoke all on public.dekez_chat_signals from public,anon,authenticated;
grant select on public.dekez_chat_signals to authenticated;
create policy dekez_chat_own_signal on public.dekez_chat_signals for select to authenticated using(user_id=(select auth.uid()));
create function dekez_chat_private.signal(p_users uuid[]) returns void language sql security definer set search_path='' as $$
 insert into public.dekez_chat_signals as s(user_id) select distinct u from unnest(p_users) u where u is not null
 on conflict(user_id) do update set revision=s.revision+1,updated_at=clock_timestamp();
$$;
create function dekez_chat_private.signal_change() returns trigger language plpgsql security definer set search_path='' as $$
declare ids uuid[];
begin
 if tg_table_name='dekez_conversation_participants' then ids:=array[new.user_id];
 elsif tg_table_name='dekez_conversations' then select array_agg(user_id) into ids from public.dekez_conversation_participants where conversation_id=new.id;
 elsif tg_table_name='dekez_support_cases' then ids:=array[new.assigned_to,old.assigned_to];
 elsif tg_table_name in ('members','profiles') then
 select array_agg(distinct p.user_id) into ids from public.dekez_conversation_participants p where p.conversation_id in(select conversation_id from public.dekez_conversation_participants where user_id=case when tg_table_name='members' then (to_jsonb(new)->>'user_id')::uuid else (to_jsonb(new)->>'id')::uuid end);
 end if;
 perform dekez_chat_private.signal(ids); return null;
end; $$;
revoke all on function dekez_chat_private.signal(uuid[]),dekez_chat_private.signal_change() from public,anon,authenticated;
create trigger dekez_chat_participant_signal after insert or update on public.dekez_conversation_participants for each row execute function dekez_chat_private.signal_change();
create trigger dekez_chat_conversation_signal after update of status on public.dekez_conversations for each row execute function dekez_chat_private.signal_change();
create trigger dekez_chat_support_signal after update on public.dekez_support_cases for each row execute function dekez_chat_private.signal_change();
create trigger dekez_chat_member_signal after update on dekez_chat_private.members for each row execute function dekez_chat_private.signal_change();
create trigger dekez_chat_profile_signal after update of role,registration_status on public.profiles for each row execute function dekez_chat_private.signal_change();
create function dekez_chat_private.audit_closed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status is distinct from new.status then insert into dekez_chat_private.audit(actor_id,action,record_id,reason)
 values(auth.uid(),'chat_status_changed',new.id,jsonb_build_object('previous',old.status,'new',new.status,'relationship',new.relationship_id)::text); end if;
 return null;
end; $$;
revoke all on function dekez_chat_private.audit_closed() from public,anon,authenticated;
create trigger dekez_chat_status_audit after update of status on public.dekez_conversations for each row execute function dekez_chat_private.audit_closed();
commit;
