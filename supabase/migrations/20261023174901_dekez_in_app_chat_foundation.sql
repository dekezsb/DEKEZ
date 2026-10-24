-- DEKEZ in-app chat, phase 1. Independent of WhatsApp and financial records.
-- Staged only: no users, relationships, Storage policies, API guard changes or
-- Realtime publication are enabled by this migration. See docs/dekez-chat.md.
begin;
create schema dekez_chat_private;
revoke all on schema dekez_chat_private from public, anon;
grant usage on schema dekez_chat_private to authenticated;

-- Explicit, reviewed enrolment. A profile/role change invalidates enrolment.
-- No public API may create these capabilities or relationship authorizations.
create table dekez_chat_private.members (
 user_id uuid primary key references public.profiles(id),
 profile_role text not null,
 chat_role text not null check(chat_role in ('owner','tenant','management','admin','contractor','staff')),
 enabled boolean not null default false,
 support_enabled boolean not null default false,
 support_dispatcher boolean not null default false,
 approved_by uuid not null references public.profiles(id),
 approved_at timestamptz not null default now(),
 check ((profile_role in ('owner','client_owner') and chat_role='owner')
 or (profile_role='tenant' and chat_role='tenant')
 or (profile_role in ('admin','admin_team') and chat_role='management')
 or (profile_role='super_admin' and chat_role='admin')
 or (profile_role in ('technician','technician_team','maintenance_staff','cleaning_staff') and chat_role='staff')
 or (profile_role='contractor_preview' and chat_role='contractor'))
);
create table dekez_chat_private.scopes (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('property','maintenance')),
 property_id uuid not null references public.properties(id),
 room_id uuid references public.rooms(id),
 tenancy_id uuid references public.tenancies(id),
 maintenance_ticket_id uuid unique references public.maintenance_tickets(id),
 closed_at timestamptz,
 created_at timestamptz not null default now(),
 check ((kind='maintenance')=(maintenance_ticket_id is not null))
);
create table dekez_chat_private.relationships (
 id uuid primary key default gen_random_uuid(),
 scope_id uuid not null references dekez_chat_private.scopes(id),
 user_a uuid not null references dekez_chat_private.members(user_id),
 user_b uuid not null references dekez_chat_private.members(user_id),
 status text not null default 'active' check(status in ('active','read_only','revoked')),
 expires_at timestamptz,
 authorized_by uuid not null references public.profiles(id),
 reason text not null check(length(trim(reason)) between 5 and 1000),
 created_at timestamptz not null default now(),
 check(user_a<user_b), unique(scope_id,user_a,user_b)
);
create index dekez_chat_relationship_a on dekez_chat_private.relationships(user_a,status);
create index dekez_chat_relationship_b on dekez_chat_private.relationships(user_b,status);

create table public.dekez_conversations (
 id uuid primary key default gen_random_uuid(),
 relationship_id uuid not null unique references dekez_chat_private.relationships(id),
 status text not null default 'active' check(status in ('active','closed')),
 message_count bigint not null default 0,
 last_message_at timestamptz,
 created_at timestamptz not null default now(),
 closed_at timestamptz
);
create table public.dekez_conversation_participants (
 conversation_id uuid not null references public.dekez_conversations(id),
 user_id uuid not null references public.profiles(id),
 joined_at timestamptz not null default now(),
 last_read_seq bigint not null default 0 check(last_read_seq>=0),
 unread_count bigint not null default 0 check(unread_count>=0),
 updated_at timestamptz not null default now(),
 primary key(conversation_id,user_id)
);
create index dekez_chat_inbox on public.dekez_conversation_participants(user_id,updated_at desc,conversation_id);
create table public.dekez_messages (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.dekez_conversations(id),
 sender_id uuid not null references public.profiles(id),
 seq bigint not null,
 client_key uuid not null,
 body text not null check(length(trim(body)) between 1 and 10000),
 created_at timestamptz not null default now(),
 unique(conversation_id,seq), unique(conversation_id,sender_id,client_key)
);
create table public.dekez_message_attachments (
 id uuid primary key default gen_random_uuid(),
 message_id uuid not null references public.dekez_messages(id),
 file_name text not null check(length(file_name) between 1 and 255),
 mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
 byte_size bigint not null check(byte_size between 1 and 10485760),
 object_key text not null unique,
 created_at timestamptz not null default now()
);
create index dekez_chat_attachment_message on public.dekez_message_attachments(message_id);
create table public.dekez_support_cases (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.dekez_conversations(id),
 reported_by uuid not null references public.profiles(id),
 reason text not null check(reason in ('not_responding','inappropriate','suspected_fraud','quotation','payment_dispute','other')),
 explanation text not null check(length(trim(explanation)) between 1 and 4000),
 status text not null default 'open' check(status in ('open','under_review','waiting_for_response','resolved','closed')),
 assigned_to uuid references public.profiles(id),
 access_until timestamptz,
 created_at timestamptz not null default now()
);
create index dekez_support_assignee on public.dekez_support_cases(assigned_to,status,created_at desc);
create index dekez_support_queue on public.dekez_support_cases(created_at desc,id desc);
create table dekez_chat_private.support_evidence (
 case_id uuid not null references public.dekez_support_cases(id),
 message_id uuid not null references public.dekez_messages(id),
 primary key(case_id,message_id)
);
create table dekez_chat_private.support_attachment_evidence (
 case_id uuid not null references public.dekez_support_cases(id),
 attachment_id uuid not null references public.dekez_message_attachments(id),
 primary key(case_id,attachment_id)
);
create table dekez_chat_private.audit (
 id bigint generated always as identity primary key,
 actor_id uuid references public.profiles(id),
 action text not null,
 record_id uuid not null,
 reason text,
 created_at timestamptz not null default clock_timestamp()
);
create table dekez_chat_private.send_limits (
 user_id uuid primary key references public.profiles(id),
 window_started_at timestamptz not null,
 sent integer not null check(sent between 1 and 60)
);

create function dekez_chat_private.current_member() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from dekez_chat_private.members m
 join public.profiles p on p.id=m.user_id where m.user_id=auth.uid() and m.enabled
 and p.role::text=m.profile_role and p.registration_status::text='approved');
$$;

-- This tests roles independently of UI, participant rows and caller-supplied IDs.
create function dekez_chat_private.valid_pair(p_relationship uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
 select 1 from dekez_chat_private.relationships r
 join dekez_chat_private.members a on a.user_id=r.user_a
 join dekez_chat_private.members b on b.user_id=r.user_b
 join public.profiles pa on pa.id=a.user_id join public.profiles pb on pb.id=b.user_id
 where r.id=p_relationship and auth.uid() in (r.user_a,r.user_b)
 and a.enabled and b.enabled and a.profile_role=pa.role::text and b.profile_role=pb.role::text
 and pa.registration_status::text='approved' and pb.registration_status::text='approved'
 and not (a.chat_role='owner' and b.chat_role='tenant' or a.chat_role='tenant' and b.chat_role='owner')
 and (a.chat_role in ('management','admin') or b.chat_role in ('management','admin')
 or a.chat_role='contractor' and b.chat_role in ('owner','tenant')
 or b.chat_role='contractor' and a.chat_role in ('owner','tenant')));
$$;

create function dekez_chat_private.can_read(p_conversation uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select dekez_chat_private.current_member() and exists(
 select 1 from public.dekez_conversation_participants p
 join public.dekez_conversations c on c.id=p.conversation_id
 join dekez_chat_private.relationships r on r.id=c.relationship_id
 where p.conversation_id=p_conversation and p.user_id=auth.uid() and r.status<>'revoked'
 and dekez_chat_private.valid_pair(r.id));
$$;

create function dekez_chat_private.can_start(p_relationship uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select dekez_chat_private.valid_pair(p_relationship) and exists(
 select 1 from dekez_chat_private.relationships r join dekez_chat_private.scopes s on s.id=r.scope_id
 where r.id=p_relationship and r.status='active' and (r.expires_at is null or r.expires_at>now()) and s.closed_at is null
 and (s.kind='property' and not exists(select 1 from dekez_chat_private.members m
 where m.user_id in(r.user_a,r.user_b) and m.chat_role='contractor')
 or s.kind='maintenance' and exists(select 1 from public.maintenance_tickets t
 where t.id=s.maintenance_ticket_id and t.property_id=s.property_id
 and (s.room_id is null or s.room_id=t.room_id)
 and t.status::text in ('submitted','assigned','in_progress','waiting_for_parts')
 and not exists(select 1 from dekez_chat_private.members m where m.user_id in(r.user_a,r.user_b)
 and m.chat_role='contractor' and not exists(select 1 from public.maintenance_ticket_assignments a
 where a.ticket_id=t.id and a.assigned_to=m.user_id and a.status in ('assigned','accepted'))))));
$$;

-- SECURITY DEFINER implementations live outside the exposed API schema and
-- check the real caller. Public wrappers are SECURITY INVOKER.
create function dekez_chat_private.open_conversation(p_relationship uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare r dekez_chat_private.relationships; c uuid; created integer; ticket uuid;
begin
 if not dekez_chat_private.valid_pair(p_relationship) then
 raise insufficient_privilege using message='This contact is not authorized for an active conversation.'; end if;
 select s.maintenance_ticket_id into ticket from dekez_chat_private.relationships v
 join dekez_chat_private.scopes s on s.id=v.scope_id where v.id=p_relationship;
 if ticket is not null then
 perform 1 from public.maintenance_tickets where id=ticket for share;
 perform 1 from public.maintenance_ticket_assignments where ticket_id=ticket for share;
 end if;
 select * into r from dekez_chat_private.relationships where id=p_relationship for update;
 if not dekez_chat_private.can_start(p_relationship) then
 raise insufficient_privilege using message='This contact is not authorized for an active conversation.'; end if;
 insert into public.dekez_conversations(relationship_id) values(r.id)
 on conflict(relationship_id) do nothing;
 get diagnostics created=row_count;
 select id into c from public.dekez_conversations where relationship_id=r.id;
 if exists(select 1 from public.dekez_conversations where id=c and status='closed') then
 raise insufficient_privilege using message='This conversation is closed.'; end if;
 insert into public.dekez_conversation_participants(conversation_id,user_id)
 values(c,r.user_a),(c,r.user_b) on conflict do nothing;
 if created=1 then insert into dekez_chat_private.audit(actor_id,action,record_id) values(auth.uid(),'conversation_created',c); end if;
 return c;
end; $$;

create function dekez_chat_private.send(p_conversation uuid,p_body text,p_key uuid) returns public.dekez_messages
language plpgsql security definer set search_path='' as $$
declare c public.dekez_conversations; result public.dekez_messages; ticket uuid; allowed integer;
begin
 if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege using message='Conversation unavailable.'; end if;
 select s.maintenance_ticket_id into ticket from public.dekez_conversations v
 join dekez_chat_private.relationships r on r.id=v.relationship_id join dekez_chat_private.scopes s on s.id=r.scope_id where v.id=p_conversation;
 -- Same lock order as ticket completion: ticket, relationship, conversation.
 if ticket is not null then
 perform 1 from public.maintenance_tickets where id=ticket for share;
 perform 1 from public.maintenance_ticket_assignments where ticket_id=ticket for share;
 end if;
 perform 1 from dekez_chat_private.relationships where id=(select relationship_id from public.dekez_conversations where id=p_conversation) for share;
 select * into c from public.dekez_conversations where id=p_conversation for update;
 if c.status<>'active' or not dekez_chat_private.can_start(c.relationship_id) then
 raise insufficient_privilege using message='This conversation is closed or its job authorization has ended.'; end if;
 if p_key is null or p_body is null or length(trim(p_body)) not between 1 and 10000 then raise exception 'Invalid message.'; end if;
 select * into result from public.dekez_messages where conversation_id=c.id and sender_id=auth.uid() and client_key=p_key;
 if found then
 if result.body<>trim(p_body) then raise exception 'Message retry does not match the original.'; end if;
 return result; end if;
 insert into dekez_chat_private.send_limits as l(user_id,window_started_at,sent) values(auth.uid(),clock_timestamp(),1)
 on conflict(user_id) do update set
 sent=case when l.window_started_at<clock_timestamp()-interval '1 minute' then 1 else l.sent+1 end,
 window_started_at=case when l.window_started_at<clock_timestamp()-interval '1 minute' then clock_timestamp() else l.window_started_at end
 where l.sent<60 or l.window_started_at<clock_timestamp()-interval '1 minute'
 returning sent into allowed;
 if allowed is null then raise exception 'Please wait before sending more messages.'; end if;
 insert into public.dekez_messages(conversation_id,sender_id,seq,client_key,body)
 values(c.id,auth.uid(),c.message_count+1,p_key,trim(p_body)) returning * into result;
 update public.dekez_conversations set message_count=result.seq,last_message_at=result.created_at where id=c.id;
 update public.dekez_conversation_participants set
 unread_count=unread_count+case when user_id=auth.uid() then 0 else 1 end,
 updated_at=result.created_at where conversation_id=c.id;
 return result;
end; $$;

create function dekez_chat_private.mark_read(p_conversation uuid,p_seq bigint) returns void
language plpgsql security definer set search_path='' as $$
declare last_seq bigint; old_seq bigint;
begin
 if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege using message='Conversation unavailable.'; end if;
 select message_count into last_seq from public.dekez_conversations where id=p_conversation for update;
 select last_read_seq into old_seq from public.dekez_conversation_participants where conversation_id=p_conversation and user_id=auth.uid() for update;
 if p_seq is null or p_seq<0 or p_seq>last_seq then raise exception 'Invalid read position.'; end if;
 if p_seq<=old_seq then return; end if;
 update public.dekez_conversation_participants set last_read_seq=p_seq,
 unread_count=greatest(0,unread_count-(select count(*) from public.dekez_messages
 where conversation_id=p_conversation and seq>old_seq and seq<=p_seq and sender_id<>auth.uid()))
 where conversation_id=p_conversation and user_id=auth.uid();
end; $$;

create function dekez_chat_private.close_ticket_chats() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status::text in ('completed','closed','rejected') then
 update dekez_chat_private.scopes set closed_at=coalesce(closed_at,now()) where maintenance_ticket_id=new.id;
 update public.dekez_conversations c set status='closed',closed_at=coalesce(c.closed_at,now())
 from dekez_chat_private.relationships r join dekez_chat_private.scopes s on s.id=r.scope_id
 where c.relationship_id=r.id and s.maintenance_ticket_id=new.id and c.status<>'closed';
 end if;
 return new;
end; $$;
create trigger dekez_chat_ticket_closed after update of status on public.maintenance_tickets
for each row execute function dekez_chat_private.close_ticket_chats();

create function dekez_chat_private.close_assignment_chats() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='DELETE' or new.status in ('completed','cancelled') or new.assigned_to<>old.assigned_to or new.ticket_id<>old.ticket_id then
 update dekez_chat_private.relationships r set status='read_only'
 from dekez_chat_private.scopes s where r.scope_id=s.id
 and s.maintenance_ticket_id=old.ticket_id and old.assigned_to in(r.user_a,r.user_b) and r.status='active';
 update public.dekez_conversations c set status='closed',closed_at=coalesce(c.closed_at,now())
 from dekez_chat_private.relationships r join dekez_chat_private.scopes s on s.id=r.scope_id
 where c.relationship_id=r.id and s.maintenance_ticket_id=old.ticket_id
 and old.assigned_to in(r.user_a,r.user_b) and c.status<>'closed';
 end if;
 return null;
end; $$;
create trigger dekez_chat_assignment_closed after update or delete on public.maintenance_ticket_assignments
for each row execute function dekez_chat_private.close_assignment_chats();

create function dekez_chat_private.report(p_conversation uuid,p_reason text,p_explanation text,p_messages uuid[],p_attachments uuid[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege using message='Conversation unavailable.'; end if;
 if coalesce(cardinality(p_messages),0)>50 or coalesce(cardinality(p_attachments),0)>50 then raise exception 'Select up to 50 evidence items.'; end if;
 if exists(select 1 from unnest(p_messages) x where not exists(select 1 from public.dekez_messages m where m.id=x and m.conversation_id=p_conversation))
 or exists(select 1 from unnest(p_attachments) x where not exists(select 1 from public.dekez_message_attachments a join public.dekez_messages m on m.id=a.message_id where a.id=x and m.conversation_id=p_conversation))
 then raise insufficient_privilege using message='Evidence must belong to this conversation.'; end if;
 insert into public.dekez_support_cases(conversation_id,reported_by,reason,explanation)
 values(p_conversation,auth.uid(),p_reason,p_explanation) returning id into result;
 insert into dekez_chat_private.support_evidence select result,x from unnest(p_messages) x on conflict do nothing;
 insert into dekez_chat_private.support_attachment_evidence select result,x from unnest(p_attachments) x on conflict do nothing;
 insert into dekez_chat_private.audit(actor_id,action,record_id) values(auth.uid(),'support_requested',result);
 return result;
end; $$;

create function dekez_chat_private.support_allowed(p_case uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select dekez_chat_private.current_member() and exists(select 1 from public.dekez_support_cases c
 join dekez_chat_private.members m on m.user_id=c.assigned_to where c.id=p_case
 and c.assigned_to=auth.uid() and m.support_enabled and m.chat_role in ('admin','management','staff')
 and c.status in ('open','under_review','waiting_for_response') and c.access_until>now());
$$;
create function dekez_chat_private.evidence(p_case uuid,p_message uuid,p_reason text) returns public.dekez_messages
language plpgsql security definer set search_path='' as $$
declare result public.dekez_messages;
begin
 perform 1 from public.dekez_support_cases where id=p_case for share;
 if not dekez_chat_private.support_allowed(p_case) or not exists(select 1 from dekez_chat_private.support_evidence where case_id=p_case and message_id=p_message)
 then raise insufficient_privilege using message='Evidence access is not authorized.'; end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise exception 'An access reason is required.'; end if;
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(auth.uid(),'support_message_view',p_message,p_case::text||': '||p_reason);
 select * into result from public.dekez_messages where id=p_message;
 return result;
end; $$;

-- No direct writes: counters, sender identity, membership, evidence and audit
-- cannot be manipulated by calling the Data API instead of the application.
do $$ declare t text; begin
 foreach t in array array['dekez_conversations','dekez_conversation_participants','dekez_messages','dekez_message_attachments','dekez_support_cases'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 end loop;
 foreach t in array array['members','scopes','relationships','support_evidence','support_attachment_evidence','audit','send_limits'] loop
 execute format('alter table dekez_chat_private.%I enable row level security',t);
 execute format('revoke all on dekez_chat_private.%I from public,anon,authenticated',t);
 end loop;
end $$;
create policy dekez_participant_conversations on public.dekez_conversations for select to authenticated using(dekez_chat_private.can_read(id));
create policy dekez_own_read_state on public.dekez_conversation_participants for select to authenticated using(user_id=(select auth.uid()) and dekez_chat_private.can_read(conversation_id));
create policy dekez_participant_messages on public.dekez_messages for select to authenticated using(dekez_chat_private.can_read(conversation_id));
create policy dekez_participant_files on public.dekez_message_attachments for select to authenticated using(exists(select 1 from public.dekez_messages m where m.id=message_id));
create policy dekez_case_access on public.dekez_support_cases for select to authenticated using(
 reported_by=(select auth.uid()) and dekez_chat_private.can_read(conversation_id));

create function public.dekez_chat_open(p_relationship uuid) returns uuid language sql security invoker set search_path='' as $$select dekez_chat_private.open_conversation(p_relationship)$$;
create function public.dekez_chat_send(p_conversation uuid,p_body text,p_key uuid) returns public.dekez_messages language sql security invoker set search_path='' as $$select dekez_chat_private.send(p_conversation,p_body,p_key)$$;
create function public.dekez_chat_read(p_conversation uuid,p_seq bigint) returns void language sql security invoker set search_path='' as $$select dekez_chat_private.mark_read(p_conversation,p_seq)$$;
create function public.dekez_chat_report(p_conversation uuid,p_reason text,p_explanation text,p_messages uuid[],p_attachments uuid[]) returns uuid language sql security invoker set search_path='' as $$select dekez_chat_private.report(p_conversation,p_reason,p_explanation,p_messages,p_attachments)$$;
create function public.dekez_chat_evidence(p_case uuid,p_message uuid,p_reason text) returns public.dekez_messages language sql security invoker set search_path='' as $$select dekez_chat_private.evidence(p_case,p_message,p_reason)$$;

-- Pagination is keyset-based, and history reads never mark unseen messages read.
create function dekez_chat_private.history(p_conversation uuid,p_before bigint,p_limit integer)
returns setof public.dekez_messages language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege using message='Conversation unavailable.'; end if;
 return query select m.* from public.dekez_messages m where m.conversation_id=p_conversation
 and (p_before is null or m.seq<p_before) order by m.seq desc limit greatest(1,least(coalesce(p_limit,40),50));
end;
$$;
create function public.dekez_chat_history(p_conversation uuid,p_before bigint default null,p_limit integer default 40)
returns setof public.dekez_messages language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.history(p_conversation,p_before,p_limit)$$;
create function dekez_chat_private.contacts(p_after uuid,p_limit integer)
returns table(relationship_id uuid,contact_id uuid,chat_role text,property_id uuid,maintenance_ticket_id uuid,contact_name text)
language sql stable security definer set search_path='' as $$
 select r.id,m.user_id,m.chat_role,s.property_id,s.maintenance_ticket_id,coalesce(nullif(p.full_name,''),'Authorized contact')
 from dekez_chat_private.relationships r join dekez_chat_private.scopes s on s.id=r.scope_id
 join dekez_chat_private.members m on m.user_id=case when r.user_a=auth.uid() then r.user_b else r.user_a end
 join public.profiles p on p.id=m.user_id
 where auth.uid() in(r.user_a,r.user_b) and (p_after is null or r.id>p_after)
 and dekez_chat_private.can_start(r.id)
 and not exists(select 1 from public.dekez_conversations c where c.relationship_id=r.id and c.status='closed')
 order by r.id limit greatest(1,least(coalesce(p_limit,25),50));
$$;
create function public.dekez_chat_contacts(p_after uuid default null,p_limit integer default 25)
returns table(relationship_id uuid,contact_id uuid,chat_role text,property_id uuid,maintenance_ticket_id uuid,contact_name text)
language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.contacts(p_after,p_limit)$$;

create function dekez_chat_private.inbox(p_before timestamptz,p_before_id uuid,p_limit integer)
returns table(conversation_id uuid,status text,last_message_at timestamptz,unread_count bigint,preview text,contact_name text)
language sql stable security definer set search_path='' as $$
 select c.id,case when c.status='closed' or not dekez_chat_private.can_start(c.relationship_id) then 'closed' else 'active' end,
 p.updated_at,p.unread_count,left(m.body,160),coalesce(nullif(other.full_name,''),'Authorized contact')
 from public.dekez_conversation_participants p join public.dekez_conversations c on c.id=p.conversation_id
 join dekez_chat_private.relationships r on r.id=c.relationship_id
 join public.profiles other on other.id=case when r.user_a=auth.uid() then r.user_b else r.user_a end
 left join public.dekez_messages m on m.conversation_id=c.id and m.seq=c.message_count
 where p.user_id=(select auth.uid()) and dekez_chat_private.can_read(c.id)
 and (p_before is null or (p.updated_at,c.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 order by p.updated_at desc,c.id desc limit greatest(1,least(coalesce(p_limit,25),50));
$$;
create function public.dekez_chat_inbox(p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns table(conversation_id uuid,status text,last_message_at timestamptz,unread_count bigint,preview text,contact_name text)
language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.inbox(p_before,p_before_id,p_limit)$$;

create function dekez_chat_private.detail(p_conversation uuid)
returns table(conversation_id uuid,status text,contact_name text,property_name text,ticket_number text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege using message='Conversation unavailable.'; end if;
 return query select c.id,case when c.status='closed' or not dekez_chat_private.can_start(r.id) then 'closed' else 'active' end,
 coalesce(nullif(p.full_name,''),'Authorized contact'),property.name,t.ticket_number
 from public.dekez_conversations c join dekez_chat_private.relationships r on r.id=c.relationship_id
 join dekez_chat_private.scopes s on s.id=r.scope_id join public.properties property on property.id=s.property_id
 join public.profiles p on p.id=case when r.user_a=auth.uid() then r.user_b else r.user_a end
 left join public.maintenance_tickets t on t.id=s.maintenance_ticket_id where c.id=p_conversation;
end; $$;
create function public.dekez_chat_detail(p_conversation uuid)
returns table(conversation_id uuid,status text,contact_name text,property_name text,ticket_number text)
language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.detail(p_conversation)$$;
-- Dispatch is an explicit capability, not a side effect of an Admin role.
-- No capability is seeded and dispatch alone never permits evidence access.
create function dekez_chat_private.can_dispatch() returns boolean
language sql stable security definer set search_path='' as $$
 select dekez_chat_private.current_member() and exists(select 1 from dekez_chat_private.members
 where user_id=auth.uid() and support_dispatcher and chat_role in ('admin','management'));
$$;
create function dekez_chat_private.support_queue(p_before timestamptz,p_before_id uuid,p_limit integer)
returns table(case_id uuid,conversation_id uuid,reported_by uuid,reason text,status text,assigned_to uuid,
 access_until timestamptz,created_at timestamptz,maintenance_ticket_id uuid,can_dispatch boolean)
language plpgsql stable security definer set search_path='' as $$
declare dispatcher boolean:=dekez_chat_private.can_dispatch();
begin
 if not dekez_chat_private.current_member() or not (dispatcher or exists(select 1 from dekez_chat_private.members
 where user_id=auth.uid() and support_enabled and chat_role in ('admin','management','staff')))
 then raise insufficient_privilege using message='Support access is not authorized.'; end if;
 return query select c.id,c.conversation_id,c.reported_by,c.reason,c.status,c.assigned_to,c.access_until,c.created_at,s.maintenance_ticket_id,dispatcher
 from public.dekez_support_cases c join public.dekez_conversations v on v.id=c.conversation_id
 join dekez_chat_private.relationships r on r.id=v.relationship_id join dekez_chat_private.scopes s on s.id=r.scope_id
 where (dispatcher or c.assigned_to=auth.uid()) and (p_before is null or (c.created_at,c.id)<(p_before,p_before_id))
 order by c.created_at desc,c.id desc limit greatest(1,least(coalesce(p_limit,25),50));
end; $$;
create function public.dekez_chat_support_queue(p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns table(case_id uuid,conversation_id uuid,reported_by uuid,reason text,status text,assigned_to uuid,
 access_until timestamptz,created_at timestamptz,maintenance_ticket_id uuid,can_dispatch boolean)
language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.support_queue(p_before,p_before_id,p_limit)$$;

create function dekez_chat_private.support_staff(p_after uuid,p_limit integer)
returns table(user_id uuid,display_name text) language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.can_dispatch() then raise insufficient_privilege using message='Support dispatch is not authorized.'; end if;
 return query select m.user_id,coalesce(nullif(p.full_name,''),'Authorized support staff')
 from dekez_chat_private.members m join public.profiles p on p.id=m.user_id
 where m.enabled and m.support_enabled and m.chat_role in ('admin','management','staff')
 and p.role::text=m.profile_role and p.registration_status::text='approved' and (p_after is null or m.user_id>p_after)
 order by m.user_id limit greatest(1,least(coalesce(p_limit,25),50));
end; $$;
create function public.dekez_chat_support_staff(p_after uuid default null,p_limit integer default 25)
returns table(user_id uuid,display_name text) language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.support_staff(p_after,p_limit)$$;

create function dekez_chat_private.support_assign(p_case uuid,p_staff uuid,p_minutes integer,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.dekez_support_cases;
begin
 if not dekez_chat_private.can_dispatch() then raise insufficient_privilege using message='Support dispatch is not authorized.'; end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 or p_minutes is null or p_minutes not between 15 and 1440
 then raise exception 'A reason and an access window of 15 minutes to 24 hours are required.'; end if;
 select * into c from public.dekez_support_cases where id=p_case for update;
 if not found or c.status not in ('open','under_review','waiting_for_response') then raise insufficient_privilege using message='This case no longer permits an access grant.'; end if;
 if not exists(select 1 from dekez_chat_private.members m join public.profiles p on p.id=m.user_id
 where m.user_id=p_staff and m.enabled and m.support_enabled and m.chat_role in ('admin','management','staff')
 and p.role::text=m.profile_role and p.registration_status::text='approved') then raise insufficient_privilege using message='The selected staff member is not authorized for support.'; end if;
 update public.dekez_support_cases set assigned_to=p_staff,access_until=now()+make_interval(mins=>p_minutes) where id=p_case;
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(auth.uid(),'support_assigned',p_case,
 jsonb_build_object('previous_staff',c.assigned_to,'previous_expiry',c.access_until,'new_staff',p_staff,'minutes',p_minutes,'reason',trim(p_reason))::text);
end; $$;
create function public.dekez_chat_support_assign(p_case uuid,p_staff uuid,p_minutes integer,p_reason text) returns void
language sql security invoker set search_path='' as $$select dekez_chat_private.support_assign(p_case,p_staff,p_minutes,p_reason)$$;

create function dekez_chat_private.support_status(p_case uuid,p_status text,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.dekez_support_cases;
begin
 select * into c from public.dekez_support_cases where id=p_case for update;
 if not found or not (dekez_chat_private.can_dispatch() or dekez_chat_private.support_allowed(p_case))
 then raise insufficient_privilege using message='Case changes are not authorized.'; end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise exception 'A reason is required.'; end if;
 if c.status not in ('open','under_review','waiting_for_response') or p_status not in ('under_review','waiting_for_response','resolved','closed') or p_status=c.status
 then raise exception 'Invalid support case transition.'; end if;
 update public.dekez_support_cases set status=p_status,
 access_until=case when p_status in ('resolved','closed') then null else access_until end where id=p_case;
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(auth.uid(),'support_status_changed',p_case,
 jsonb_build_object('previous_status',c.status,'new_status',p_status,'reason',trim(p_reason))::text);
end; $$;
create function public.dekez_chat_support_status(p_case uuid,p_status text,p_reason text) returns void
language sql security invoker set search_path='' as $$select dekez_chat_private.support_status(p_case,p_status,p_reason)$$;

create function dekez_chat_private.support_manifest(p_case uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform 1 from public.dekez_support_cases where id=p_case for share;
 if not dekez_chat_private.support_allowed(p_case) then raise insufficient_privilege using message='Evidence access is not authorized.'; end if;
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise exception 'An access reason is required.'; end if;
 select jsonb_build_object('explanation',c.explanation,'access_until',c.access_until,
 'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'seq',m.seq,'created_at',m.created_at) order by m.seq)
 from dekez_chat_private.support_evidence e join public.dekez_messages m on m.id=e.message_id where e.case_id=p_case),'[]'::jsonb))
 into result from public.dekez_support_cases c where c.id=p_case;
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(auth.uid(),'support_report_view',p_case,trim(p_reason));
 return result;
end; $$;
create function public.dekez_chat_support_manifest(p_case uuid,p_reason text) returns jsonb
language sql security invoker set search_path='' as $$select dekez_chat_private.support_manifest(p_case,p_reason)$$;

do $$ declare f record; begin
 for f in select p.oid::regprocedure signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='dekez_chat_private' or n.nspname='public' and p.proname like 'dekez_chat_%' loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 if f.proname not in ('close_ticket_chats','close_assignment_chats') then execute format('grant execute on function %s to authenticated',f.signature); end if;
 end loop;
end $$;
commit;
