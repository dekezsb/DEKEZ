-- Additive chat presentation/source metadata. No role, RLS, rental or WhatsApp changes.
-- Depends on the separately reviewed tenant-reminder migration. Welcome OFF by default.
begin;
alter table public.dekez_messages add column message_type text
 check(message_type in ('MANUAL_ADMIN','USER_MESSAGE','AUTO_REMINDER','WELCOME_MESSAGE','SYSTEM_NOTICE'));
-- Existing history is deliberately NOT backfilled or reclassified.
create index dekez_chat_reminder_threads on public.dekez_messages(conversation_id)
 where message_type='AUTO_REMINDER';

create function dekez_chat_private.classify_message() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Callers never supply source metadata: the existing send path owns identity.
 new.message_type:=case when exists(select 1 from dekez_chat_private.members m
 where m.user_id=new.sender_id and m.chat_role in ('admin','management')) then 'MANUAL_ADMIN' else 'USER_MESSAGE' end;
 new.system_label:=null;
 return new;
end; $$;
create trigger dekez_chat_classify_message before insert on public.dekez_messages
 for each row execute function dekez_chat_private.classify_message();

create function dekez_chat_private.classify_reminder() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 -- Only the private delivery ledger can attest an automated reminder. The
 -- update and original message commit atomically before Realtime is delivered.
 update public.dekez_messages set message_type='AUTO_REMINDER',system_label='DEKEZ Admin'
 where id=new.message_id and conversation_id=new.conversation_id and sender_id=new.sender_id;
 if not found then raise exception 'Reminder message identity mismatch.'; end if;
 return new;
end; $$;
create trigger dekez_chat_classify_reminder after insert on dekez_chat_private.reminder_deliveries
 for each row execute function dekez_chat_private.classify_reminder();

create table dekez_chat_private.welcome_control (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false
);
insert into dekez_chat_private.welcome_control default values;
create table dekez_chat_private.welcome_deliveries (
 relationship_id uuid primary key references dekez_chat_private.relationships(id),
 conversation_id uuid not null references public.dekez_conversations(id),
 message_id uuid not null unique references public.dekez_messages(id),
 sender_id uuid not null references public.profiles(id),
 initiated_by uuid not null references public.profiles(id),
 sent_at timestamptz not null default now()
);
alter table dekez_chat_private.welcome_control enable row level security;
alter table dekez_chat_private.welcome_deliveries enable row level security;
revoke all on dekez_chat_private.welcome_control,dekez_chat_private.welcome_deliveries from public,anon,authenticated,service_role;

create function dekez_chat_private.welcome_new_conversation() returns trigger
language plpgsql security definer set search_path='' as $$
declare relation uuid; sender uuid; actor uuid:=auth.uid(); message public.dekez_messages;
 original_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 if not coalesce((select enabled from dekez_chat_private.welcome_control where singleton),false) then return new; end if;
 -- A welcome never creates a relationship, participant, or conversation.
 if actor is null or not dekez_chat_private.can_read(new.conversation_id) then return new; end if;
 select c.relationship_id,staff.user_id into relation,sender
 from public.dekez_conversations c join dekez_chat_private.relationships r on r.id=c.relationship_id
 join dekez_chat_private.members staff on staff.user_id in(r.user_a,r.user_b) and staff.chat_role in ('admin','management')
 join dekez_chat_private.members tenant on tenant.user_id in(r.user_a,r.user_b) and tenant.chat_role='tenant'
 where c.id=new.conversation_id and c.status='active' and c.message_count=0
 and exists(select 1 from public.dekez_conversation_participants p where p.conversation_id=c.id and p.user_id=staff.user_id)
 and exists(select 1 from public.dekez_conversation_participants p where p.conversation_id=c.id and p.user_id=tenant.user_id);
 if sender is null then return new; end if;
 perform 1 from public.dekez_conversations where id=new.conversation_id for update;
 if exists(select 1 from dekez_chat_private.welcome_deliveries where relationship_id=relation) then return new; end if;
 perform set_config('request.jwt.claim.sub',sender::text,true);
 if not dekez_chat_private.can_start(relation) then
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true); return new;
 end if;
 message:=dekez_chat_private.send(new.conversation_id,
  'Welcome to DEKEZ. You can use this chat to contact our management team regarding rental, tenancy documents, payments and maintenance matters. Automated reminders may also be sent here for important due dates.',gen_random_uuid());
 update public.dekez_messages set message_type='WELCOME_MESSAGE',system_label='DEKEZ Admin' where id=message.id;
 insert into dekez_chat_private.welcome_deliveries(relationship_id,conversation_id,message_id,sender_id,initiated_by)
 values(relation,new.conversation_id,message.id,sender,actor);
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason)
 values(actor,'welcome_message_sent',message.id,'Automated welcome / relationship '||relation::text);
 perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
 return new;
exception when others then
 -- Roll back only welcome work; opening an authorized chat still works.
 perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason)
 values(actor,'welcome_message_failed',new.conversation_id,'SQLSTATE '||sqlstate);
 return new;
end; $$;
create trigger dekez_chat_welcome_new_conversation after insert on public.dekez_conversation_participants
 for each row execute function dekez_chat_private.welcome_new_conversation();

-- Versioned overloads preserve older clients. Filters are applied BEFORE paging,
-- and cannot broaden the participant authorization used by the existing inbox.
create function dekez_chat_private.inbox(p_before timestamptz,p_before_id uuid,p_limit integer,p_filter text)
returns table(conversation_id uuid,status text,last_message_at timestamptz,unread_count bigint,preview text,contact_name text,
 contact_role text,property_name text,ticket_number text,latest_message_type text,needs_reply boolean,message_time timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.current_member() then raise insufficient_privilege; end if;
 if p_filter is null or p_filter not in ('all','unread','tenant','owner','contractor','automated','needs_reply') then raise exception 'Invalid inbox filter.'; end if;
 return query select c.id,case when c.status='closed' or not dekez_chat_private.can_start(r.id) then 'closed' else 'active' end,
 p.updated_at,p.unread_count,left(m.body,160),dekez_chat_private.contact_label(s.id,other.user_id),other.chat_role,
 coalesce(property.name,d.label,'DEKEZ'),t.ticket_number,m.message_type,
 coalesce(m.sender_id<>auth.uid() and p.unread_count>0 and (m.message_type='USER_MESSAGE' or (m.message_type is null and other.chat_role not in ('admin','management'))),false),c.last_message_at
 from public.dekez_conversation_participants p join public.dekez_conversations c on c.id=p.conversation_id
 join dekez_chat_private.relationships r on r.id=c.relationship_id join dekez_chat_private.scopes s on s.id=r.scope_id
 join dekez_chat_private.members other on other.user_id=case when r.user_a=auth.uid() then r.user_b else r.user_a end
 left join public.properties property on property.id=s.property_id left join dekez_chat_private.desks d on d.id=s.desk_id
 left join public.maintenance_tickets t on t.id=s.maintenance_ticket_id
 left join public.dekez_messages m on m.conversation_id=c.id and m.seq=c.message_count
 where p.user_id=(select auth.uid()) and dekez_chat_private.can_read(c.id)
 and (p_before is null or (p.updated_at,c.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 and (p_filter='all' or (p_filter='unread' and p.unread_count>0) or p_filter=other.chat_role
 or (p_filter='needs_reply' and p.unread_count>0 and m.sender_id<>auth.uid() and (m.message_type='USER_MESSAGE' or (m.message_type is null and other.chat_role not in ('admin','management'))))
 or (p_filter='automated' and exists(select 1 from public.dekez_messages a where a.conversation_id=c.id and a.message_type='AUTO_REMINDER')))
 order by p.updated_at desc,c.id desc limit greatest(1,least(coalesce(p_limit,25),50));
end; $$;
create function public.dekez_chat_inbox(p_before timestamptz,p_before_id uuid,p_limit integer,p_filter text)
returns table(conversation_id uuid,status text,last_message_at timestamptz,unread_count bigint,preview text,contact_name text,
 contact_role text,property_name text,ticket_number text,latest_message_type text,needs_reply boolean,message_time timestamptz)
language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.inbox(p_before,p_before_id,p_limit,p_filter)$$;

create function dekez_chat_private.detail(p_conversation uuid,p_context boolean)
returns table(conversation_id uuid,status text,contact_name text,property_name text,ticket_number text,contact_role text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege; end if;
 return query select base.*,m.chat_role from dekez_chat_private.detail(p_conversation) base
 join public.dekez_conversations c on c.id=base.conversation_id
 join dekez_chat_private.relationships r on r.id=c.relationship_id
 join dekez_chat_private.members m on m.user_id=case when r.user_a=auth.uid() then r.user_b else r.user_a end;
end; $$;
create function public.dekez_chat_detail(p_conversation uuid,p_context boolean)
returns table(conversation_id uuid,status text,contact_name text,property_name text,ticket_number text,contact_role text)
language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.detail(p_conversation,p_context)$$;

revoke all on function dekez_chat_private.classify_message(),dekez_chat_private.classify_reminder(),dekez_chat_private.welcome_new_conversation(),
 dekez_chat_private.inbox(timestamptz,uuid,integer,text),public.dekez_chat_inbox(timestamptz,uuid,integer,text),
 dekez_chat_private.detail(uuid,boolean),public.dekez_chat_detail(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function dekez_chat_private.inbox(timestamptz,uuid,integer,text),public.dekez_chat_inbox(timestamptz,uuid,integer,text),
 dekez_chat_private.detail(uuid,boolean),public.dekez_chat_detail(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
