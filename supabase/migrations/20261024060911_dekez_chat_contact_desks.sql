-- Shared chat foundation: a staffed contact desk is independent of maintenance.
-- No changes to existing identities, property assignments, financial or WhatsApp data.
begin;
create table dekez_chat_private.desks (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null references public.companies(id),
 staff_id uuid not null references public.profiles(id),
 label text not null,
 contractor_access boolean not null default false,
 enabled boolean not null default true,
 unique(company_id,staff_id)
);
alter table dekez_chat_private.desks enable row level security;
revoke all on dekez_chat_private.desks from public,anon,authenticated;

-- Use existing authorized internal company accounts; no account selection or
-- fake maintenance assignment is needed to contact DEKEZ. Only Super Admin desks
-- accept contractors without an existing company/property relationship.
insert into dekez_chat_private.desks(company_id,staff_id,label,contractor_access)
select distinct cu.company_id,p.id,
 case when p.role='super_admin' then 'DEKEZ Support' else 'Property Management' end||' · '||coalesce(nullif(p.full_name,''),'DEKEZ'),p.role='super_admin'
from public.company_users cu join public.profiles p on p.id=coalesce(cu.profile_id,cu.user_id)
where cu.status::text='active' and p.registration_status='approved' and p.role in ('super_admin','admin','admin_team');

alter table dekez_chat_private.scopes drop constraint scopes_kind_check;
alter table dekez_chat_private.scopes add constraint scopes_kind_check check(kind in ('property','maintenance','contact_desk'));
alter table dekez_chat_private.scopes alter column property_id drop not null;
alter table dekez_chat_private.scopes add column desk_id uuid unique references dekez_chat_private.desks(id);
alter table dekez_chat_private.scopes add constraint scopes_desk_shape check(
 (kind='contact_desk' and desk_id is not null and property_id is null and room_id is null and tenancy_id is null and maintenance_ticket_id is null)
 or (kind<>'contact_desk' and desk_id is null and property_id is not null));

create function dekez_chat_private.ensure_member(p_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare p public.profiles; mapped text;
begin
 select * into p from public.profiles where id=p_user for share;
 if not found or p.registration_status<>'approved' then raise insufficient_privilege; end if;
 mapped:=case when p.role in ('owner','client_owner') then 'owner' when p.role='tenant' then 'tenant'
 when p.role in ('admin','admin_team') then 'management' when p.role='super_admin' then 'admin'
 when p.role in ('technician','technician_team','maintenance_staff','cleaning_staff') then 'staff'
 when p.role='contractor_preview' then 'contractor' end;
 if mapped is null or (p.role='client_owner' and not exists(select 1 from public.client_owner_settings where owner_id=p.id and enabled)) then raise insufficient_privilege; end if;
 insert into dekez_chat_private.members(user_id,profile_role,chat_role,enabled,approved_by)
 values(p.id,p.role,mapped,true,p.id) on conflict(user_id) do nothing;
 if found then insert into dekez_chat_private.audit(actor_id,action,record_id,reason)
 values(auth.uid(),'chat_foundation_enrolled',p.id,'Approved account enrolled under shared chat foundation policy; no support privileges granted'); end if;
 -- Never undo a deliberate suspension, role mismatch or explicit disabled grant.
 if not exists(select 1 from dekez_chat_private.members where user_id=p.id and enabled and profile_role=p.role and chat_role=mapped) then raise insufficient_privilege; end if;
end; $$;
create function dekez_chat_private.bootstrap() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise insufficient_privilege; end if;
 perform dekez_chat_private.ensure_member(auth.uid());
end; $$;
create function public.dekez_chat_bootstrap() returns void language sql security invoker set search_path='' as $$select dekez_chat_private.bootstrap()$$;

create function dekez_chat_private.desk_allowed(p_desk uuid,p_requester uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from dekez_chat_private.desks d join public.profiles staff on staff.id=d.staff_id
 join public.profiles requester on requester.id=p_requester
 where d.id=p_desk and d.enabled and d.staff_id<>p_requester
 and staff.registration_status='approved' and staff.role in ('super_admin','admin','admin_team')
 and requester.registration_status='approved' and dekez_chat_private.in_company(staff.id,d.company_id)
 and (dekez_chat_private.account_company(requester.id,d.company_id)
 or requester.role='contractor_preview' and d.contractor_access and staff.role='super_admin'));
$$;
create function dekez_chat_private.desks_list() returns table(desk_id uuid,label text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.current_member() then raise insufficient_privilege; end if;
 return query select d.id,d.label from dekez_chat_private.desks d
 where dekez_chat_private.desk_allowed(d.id,auth.uid())
 and not exists(select 1 from dekez_chat_private.members m where m.user_id=d.staff_id and not m.enabled)
 order by d.label,d.id limit 25;
end; $$;
create function public.dekez_chat_desks() returns table(desk_id uuid,label text) language sql stable security invoker set search_path='' as $$select * from dekez_chat_private.desks_list()$$;

create or replace function dekez_chat_private.can_start(p_relationship uuid) returns boolean language sql stable security definer set search_path='' as $$
 select dekez_chat_private.valid_pair(p_relationship) and exists(select 1 from dekez_chat_private.relationships r
 join dekez_chat_private.scopes s on s.id=r.scope_id where r.id=p_relationship and r.status='active'
 and (r.expires_at is null or r.expires_at>now()) and s.closed_at is null and (
 s.kind='contact_desk' and exists(select 1 from dekez_chat_private.desks d where d.id=s.desk_id
 and d.staff_id in(r.user_a,r.user_b) and dekez_chat_private.desk_allowed(d.id,case when d.staff_id=r.user_a then r.user_b else r.user_a end))
 or s.kind<>'contact_desk' and dekez_chat_private.grant_is_active(r.id)
 and dekez_chat_private.source_authorized(r.user_a,s.property_id,s.room_id,s.tenancy_id,s.maintenance_ticket_id)
 and dekez_chat_private.source_authorized(r.user_b,s.property_id,s.room_id,s.tenancy_id,s.maintenance_ticket_id)));
$$;
create function dekez_chat_private.desk_open(p_desk uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare d dekez_chat_private.desks; scope uuid; relation uuid;
begin
 perform dekez_chat_private.bootstrap();
 select * into d from dekez_chat_private.desks where id=p_desk for share;
 if not found or not dekez_chat_private.desk_allowed(p_desk,auth.uid()) then raise insufficient_privilege; end if;
 perform dekez_chat_private.ensure_member(d.staff_id);
 perform pg_advisory_xact_lock(hashtextextended('dekez-desk:'||p_desk::text,0));
 insert into dekez_chat_private.scopes(kind,desk_id) values('contact_desk',p_desk) on conflict(desk_id) do nothing;
 select id into scope from dekez_chat_private.scopes where desk_id=p_desk and closed_at is null;
 if scope is null then raise insufficient_privilege; end if;
 insert into dekez_chat_private.relationships(scope_id,user_a,user_b,authorized_by,reason)
 values(scope,least(auth.uid(),d.staff_id),greatest(auth.uid(),d.staff_id),auth.uid(),'Participant requested a scoped DEKEZ contact desk conversation') on conflict(scope_id,user_a,user_b) do nothing;
 select id into relation from dekez_chat_private.relationships where scope_id=scope and user_a=least(auth.uid(),d.staff_id) and user_b=greatest(auth.uid(),d.staff_id);
 return dekez_chat_private.open_conversation(relation);
end; $$;
create function public.dekez_chat_desk_open(p_desk uuid) returns uuid language sql security invoker set search_path='' as $$select dekez_chat_private.desk_open(p_desk)$$;

create or replace function dekez_chat_private.detail(p_conversation uuid)
returns table(conversation_id uuid,status text,contact_name text,property_name text,ticket_number text)
language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege using message='Conversation unavailable.'; end if;
 return query select c.id,case when c.status='closed' or not dekez_chat_private.can_start(r.id) then 'closed' else 'active' end,
 coalesce(nullif(p.full_name,''),'Authorized contact'),coalesce(property.name,d.label,'DEKEZ'),t.ticket_number
 from public.dekez_conversations c join dekez_chat_private.relationships r on r.id=c.relationship_id
 join dekez_chat_private.scopes s on s.id=r.scope_id left join public.properties property on property.id=s.property_id
 left join dekez_chat_private.desks d on d.id=s.desk_id
 join public.profiles p on p.id=case when r.user_a=auth.uid() then r.user_b else r.user_a end
 left join public.maintenance_tickets t on t.id=s.maintenance_ticket_id where c.id=p_conversation;
end; $$;

-- Support cases retain company boundaries even for a desk with no property.
-- This does not grant staff access: explicit assignment, evidence selection,
-- expiry, auditing and closed-case checks remain in the existing functions.
create or replace function dekez_chat_private.case_in_company(p_case uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.dekez_support_cases c join public.dekez_conversations v on v.id=c.conversation_id
 join dekez_chat_private.relationships r on r.id=v.relationship_id join dekez_chat_private.scopes s on s.id=r.scope_id
 left join public.properties p on p.id=s.property_id left join dekez_chat_private.desks d on d.id=s.desk_id
 where c.id=p_case and dekez_chat_private.in_company(auth.uid(),coalesce(p.company_id,d.company_id)));
$$;
create or replace function dekez_chat_private.support_assign(p_case uuid,p_staff uuid,p_minutes integer,p_reason text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not dekez_chat_private.case_in_company(p_case) or not exists(select 1 from public.dekez_support_cases c
 join public.dekez_conversations v on v.id=c.conversation_id join dekez_chat_private.relationships r on r.id=v.relationship_id
 join dekez_chat_private.scopes s on s.id=r.scope_id left join public.properties p on p.id=s.property_id
 left join dekez_chat_private.desks d on d.id=s.desk_id
 where c.id=p_case and dekez_chat_private.in_company(p_staff,coalesce(p.company_id,d.company_id))) then raise insufficient_privilege; end if;
 perform dekez_chat_private.assign_case(p_case,p_staff,p_minutes,p_reason);
end; $$;

-- Installation preserves existing guards. Bootstrap is the only pre-enrolment
-- exception, restricted to approved existing identities and POST.
create or replace function dekez_chat_private.check_request() returns void language plpgsql security definer set search_path='' as $$
declare path text:=trim(both '/' from coalesce(current_setting('request.path',true),'')); method text:=coalesce(current_setting('request.method',true),'');
begin
 if method='POST' and path='rpc/dekez_chat_bootstrap' and exists(select 1 from public.profiles where id=auth.uid() and registration_status='approved') then return; end if;
 if (dekez_chat_private.current_member() or dekez_chat_private.can_provision()) and (
 (method in ('GET','POST') and path=any(array['rpc/dekez_chat_desks','rpc/dekez_chat_inbox','rpc/dekez_chat_contacts','rpc/dekez_chat_detail','rpc/dekez_chat_history','rpc/dekez_chat_support_queue','rpc/dekez_chat_support_staff','rpc/dekez_chat_setup_options']))
 or (method='POST' and path=any(array['rpc/dekez_chat_desk_open','rpc/dekez_chat_open','rpc/dekez_chat_send','rpc/dekez_chat_read','rpc/dekez_chat_report','rpc/dekez_chat_evidence','rpc/dekez_chat_support_manifest','rpc/dekez_chat_support_assign','rpc/dekez_chat_support_status','rpc/dekez_chat_member_setup','rpc/dekez_chat_relationship_setup','rpc/dekez_chat_relationship_revoke','rpc/dekez_chat_file_reserve','rpc/dekez_chat_file_send','rpc/dekez_chat_files','rpc/dekez_chat_file_access']))
 ) then return; end if;
 perform marketplace_private.check_request();
end; $$;
revoke all on function dekez_chat_private.ensure_member(uuid),dekez_chat_private.desk_allowed(uuid,uuid),dekez_chat_private.bootstrap(),dekez_chat_private.desks_list(),dekez_chat_private.desk_open(uuid),public.dekez_chat_bootstrap(),public.dekez_chat_desks(),public.dekez_chat_desk_open(uuid) from public,anon,authenticated;
grant execute on function dekez_chat_private.bootstrap(),dekez_chat_private.desks_list(),dekez_chat_private.desk_open(uuid),public.dekez_chat_bootstrap(),public.dekez_chat_desks(),public.dekez_chat_desk_open(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
