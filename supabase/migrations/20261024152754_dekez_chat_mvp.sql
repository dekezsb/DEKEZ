-- Chat-only functions; no data rewrites, table changes or rental/WhatsApp access.
begin;
create function dekez_chat_private.summary() returns table(user_id uuid,unread_count bigint)
language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.current_member() then raise insufficient_privilege; end if;
 return query select auth.uid(),coalesce(sum(p.unread_count),0)::bigint
 from public.dekez_conversation_participants p
 where p.user_id=(select auth.uid()) and p.unread_count>0 and dekez_chat_private.can_read(p.conversation_id);
end; $$;
create function public.dekez_chat_summary() returns table(user_id uuid,unread_count bigint)
language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.summary()$$;
revoke all on function dekez_chat_private.summary(),public.dekez_chat_summary() from public,anon,authenticated;
grant execute on function dekez_chat_private.summary(),public.dekez_chat_summary() to authenticated;

-- Return short identification from this relationship's scope only. Do not look
-- up unrelated tenancies or expose full legal names in tenant inbox labels.
create function dekez_chat_private.contact_label(p_scope uuid,p_other uuid) returns text
language sql stable security definer set search_path='' as $$
 select case when p.role::text='tenant' then
 coalesce(nullif(split_part(trim(p.full_name),' ',1),''),'Tenant') ||
 case when nullif(room.room_number,'') is not null then ' · '||room.room_number else '' end
 else coalesce(nullif(p.full_name,''),'Authorized contact') end
 from public.profiles p join dekez_chat_private.scopes s on s.id=p_scope
 left join public.maintenance_tickets t on t.id=s.maintenance_ticket_id
 left join public.rooms room on room.id=coalesce(s.room_id,t.room_id)
 where p.id=p_other and auth.uid() is not null and exists(
 select 1 from dekez_chat_private.relationships r where r.scope_id=p_scope
 and auth.uid() in(r.user_a,r.user_b) and p_other=case when r.user_a=auth.uid() then r.user_b else r.user_a end
 and dekez_chat_private.valid_pair(r.id));
$$;
revoke all on function dekez_chat_private.contact_label(uuid,uuid) from public,anon,authenticated;

create or replace function dekez_chat_private.desk_allowed(p_desk uuid,p_requester uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from dekez_chat_private.desks d join public.profiles staff on staff.id=d.staff_id
 join public.profiles requester on requester.id=p_requester
 where d.id=p_desk and d.enabled and d.staff_id<>p_requester
 and staff.registration_status='approved' and staff.role in ('super_admin','admin','admin_team')
 and requester.registration_status='approved' and dekez_chat_private.in_company(staff.id,d.company_id)
 and requester.role::text<>'contractor_preview'
 and dekez_chat_private.account_company(requester.id,d.company_id));
$$;

create or replace function dekez_chat_private.contacts(p_after uuid,p_limit integer)
returns table(relationship_id uuid,contact_id uuid,chat_role text,property_id uuid,maintenance_ticket_id uuid,contact_name text)
language sql stable security definer set search_path='' as $$
 select r.id,m.user_id,m.chat_role,s.property_id,s.maintenance_ticket_id,dekez_chat_private.contact_label(s.id,p.id)
 from dekez_chat_private.relationships r join dekez_chat_private.scopes s on s.id=r.scope_id
 join dekez_chat_private.members m on m.user_id=case when r.user_a=auth.uid() then r.user_b else r.user_a end
 join public.profiles p on p.id=m.user_id
 where auth.uid() in(r.user_a,r.user_b) and (p_after is null or r.id>p_after)
 and dekez_chat_private.can_start(r.id)
 and not exists(select 1 from public.dekez_conversations c where c.relationship_id=r.id and c.status='closed')
 order by r.id limit greatest(1,least(coalesce(p_limit,25),50));
$$;

create or replace function dekez_chat_private.inbox(p_before timestamptz,p_before_id uuid,p_limit integer)
returns table(conversation_id uuid,status text,last_message_at timestamptz,unread_count bigint,preview text,contact_name text)
language sql stable security definer set search_path='' as $$
 select c.id,case when c.status='closed' or not dekez_chat_private.can_start(c.relationship_id) then 'closed' else 'active' end,
 p.updated_at,p.unread_count,left(m.body,160),dekez_chat_private.contact_label(r.scope_id,other.id)
 from public.dekez_conversation_participants p join public.dekez_conversations c on c.id=p.conversation_id
 join dekez_chat_private.relationships r on r.id=c.relationship_id
 join public.profiles other on other.id=case when r.user_a=auth.uid() then r.user_b else r.user_a end
 left join public.dekez_messages m on m.conversation_id=c.id and m.seq=c.message_count
 where p.user_id=(select auth.uid()) and dekez_chat_private.can_read(c.id)
 and (p_before is null or (p.updated_at,c.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 order by p.updated_at desc,c.id desc limit greatest(1,least(coalesce(p_limit,25),50));
$$;

create or replace function dekez_chat_private.detail(p_conversation uuid)
returns table(conversation_id uuid,status text,contact_name text,property_name text,ticket_number text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege using message='Conversation unavailable.'; end if;
 return query select c.id,case when c.status='closed' or not dekez_chat_private.can_start(r.id) then 'closed' else 'active' end,
 dekez_chat_private.contact_label(s.id,p.id),coalesce(property.name,d.label,'DEKEZ'),t.ticket_number
 from public.dekez_conversations c join dekez_chat_private.relationships r on r.id=c.relationship_id
 join dekez_chat_private.scopes s on s.id=r.scope_id left join public.properties property on property.id=s.property_id
 left join dekez_chat_private.desks d on d.id=s.desk_id
 join public.profiles p on p.id=case when r.user_a=auth.uid() then r.user_b else r.user_a end
 left join public.maintenance_tickets t on t.id=s.maintenance_ticket_id where c.id=p_conversation;
end; $$;

create or replace function dekez_chat_private.check_request() returns void language plpgsql security definer set search_path='' as $$
declare path text:=trim(both '/' from coalesce(current_setting('request.path',true),'')); method text:=coalesce(current_setting('request.method',true),'');
begin
 if method='POST' and path='rpc/dekez_chat_bootstrap' and exists(select 1 from public.profiles where id=auth.uid() and registration_status='approved') then return; end if;
 if (dekez_chat_private.current_member() or dekez_chat_private.can_provision()) and (
 (method in ('GET','POST') and path=any(array['rpc/dekez_chat_summary','rpc/dekez_chat_desks','rpc/dekez_chat_inbox','rpc/dekez_chat_contacts','rpc/dekez_chat_detail','rpc/dekez_chat_history','rpc/dekez_chat_support_queue','rpc/dekez_chat_support_staff','rpc/dekez_chat_setup_options']))
 or (method='POST' and path=any(array['rpc/dekez_chat_desk_open','rpc/dekez_chat_open','rpc/dekez_chat_send','rpc/dekez_chat_read','rpc/dekez_chat_report','rpc/dekez_chat_evidence','rpc/dekez_chat_support_manifest','rpc/dekez_chat_support_assign','rpc/dekez_chat_support_status','rpc/dekez_chat_member_setup','rpc/dekez_chat_relationship_setup','rpc/dekez_chat_relationship_revoke','rpc/dekez_chat_file_reserve','rpc/dekez_chat_file_send','rpc/dekez_chat_files','rpc/dekez_chat_file_access']))
 ) then return; end if;
 perform marketplace_private.check_request();
end; $$;
notify pgrst,'reload schema';
commit;
