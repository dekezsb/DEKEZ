-- Inert, additive in-app assistant. No financial/tenancy/WhatsApp writes.
begin;
alter table public.dekez_messages drop constraint dekez_messages_message_type_check;
alter table public.dekez_messages add constraint dekez_messages_message_type_check check(message_type in
 ('MANUAL_ADMIN','USER_MESSAGE','AUTO_REMINDER','WELCOME_MESSAGE','SYSTEM_NOTICE','AI_ASSISTANT'));
alter table public.dekez_messages drop constraint dekez_messages_system_label_check;
alter table public.dekez_messages add constraint dekez_messages_system_label_check check(system_label in ('DEKEZ Admin','DEKEZ Assistant'));

create table dekez_chat_private.assistant_control (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 delay_seconds integer not null default 120 check(delay_seconds between 30 and 3600),
 office_start time, office_end time, office_days integer[],
 check((office_start is null and office_end is null and office_days is null) or
 (office_start is not null and office_end is not null and office_end>office_start
  and office_days is not null and array_position(office_days,null) is null
  and office_days<@array[0,1,2,3,4,5,6]))
);
insert into dekez_chat_private.assistant_control default values;
create table dekez_chat_private.assistant_state (
 conversation_id uuid primary key references public.dekez_conversations(id),
 mode text not null default 'active' check(mode in ('active','takeover','escalated')),
 needs_admin_reply boolean not null default false, ai_answered boolean not null default false,
 pending_message uuid references public.dekez_messages(id), due_at timestamptz,
 lease_token uuid, lease_until timestamptz, after_hours_at timestamptz,
 updated_at timestamptz not null default now()
);
create index dekez_assistant_pending on dekez_chat_private.assistant_state(due_at,conversation_id) where pending_message is not null and mode='active';
create table dekez_chat_private.assistant_deliveries (
 request_message uuid primary key references public.dekez_messages(id),
 reply_message uuid not null unique references public.dekez_messages(id),
 conversation_id uuid not null references public.dekez_conversations(id), intent text not null,
 outcome text not null check(outcome in ('answered','escalated')), source_id uuid,
 sender_id uuid not null references public.profiles(id), created_at timestamptz not null default now()
);
alter table dekez_chat_private.assistant_control enable row level security;
alter table dekez_chat_private.assistant_state enable row level security;
alter table dekez_chat_private.assistant_deliveries enable row level security;
revoke all on dekez_chat_private.assistant_control,dekez_chat_private.assistant_state,dekez_chat_private.assistant_deliveries from public,anon,authenticated,service_role;

create function dekez_chat_private.assistant_parties(p_conversation uuid)
returns table(tenant_id uuid,admin_id uuid,relationship_id uuid,scope_id uuid)
language sql stable security definer set search_path='' as $$
 select tenant.user_id,staff.user_id,r.id,r.scope_id
 from public.dekez_conversations c join dekez_chat_private.relationships r on r.id=c.relationship_id
 join dekez_chat_private.scopes scope on scope.id=r.scope_id and scope.kind<>'maintenance'
 join dekez_chat_private.members tenant on tenant.user_id in(r.user_a,r.user_b) and tenant.chat_role='tenant' and tenant.enabled
 join dekez_chat_private.members staff on staff.user_id in(r.user_a,r.user_b) and staff.chat_role in ('admin','management') and staff.enabled
 where c.id=p_conversation and c.status='active' and r.status='active';
$$;

-- Deferred until the trusted source classifier has finalized automation labels.
-- Reminders/welcomes/assistant replies must never masquerade as human takeover.
create function dekez_chat_private.assistant_message_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare m public.dekez_messages; delay integer; parties record;
begin
 select * into m from public.dekez_messages where id=new.id;
 if m.message_type not in ('USER_MESSAGE','MANUAL_ADMIN') then return new; end if;
 select * into parties from dekez_chat_private.assistant_parties(m.conversation_id);
 if not found then return new; end if;
 if m.message_type='MANUAL_ADMIN' and m.sender_id=parties.admin_id then
  insert into dekez_chat_private.assistant_state(conversation_id,mode) values(m.conversation_id,'takeover')
  on conflict(conversation_id) do update set mode='takeover',needs_admin_reply=false,ai_answered=false,pending_message=null,lease_token=null,lease_until=null,updated_at=now();
  insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(m.sender_id,'assistant_takeover',m.conversation_id,'Manual Admin reply');
 elsif m.sender_id=parties.tenant_id then
  select delay_seconds into delay from dekez_chat_private.assistant_control where singleton and enabled;
  if delay is null then return new; end if;
  insert into dekez_chat_private.assistant_state(conversation_id,pending_message,due_at) values(m.conversation_id,m.id,clock_timestamp()+make_interval(secs=>delay))
  on conflict(conversation_id) do update set pending_message=case when assistant_state.mode='active' then m.id end,
   due_at=clock_timestamp()+make_interval(secs=>delay),needs_admin_reply=assistant_state.mode<>'active',ai_answered=false,lease_token=null,lease_until=null,updated_at=now();
 end if;
 return new;
end; $$;
create constraint trigger dekez_assistant_message_event after insert on public.dekez_messages
 deferrable initially deferred for each row execute function dekez_chat_private.assistant_message_event();

-- Returns only a fixed, reviewed answer assembled from current, scoped records.
-- No model receives financial rows, agreement text, other users or tool access.
create function dekez_chat_private.assistant_answer(p_conversation uuid,p_intent text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare parties record; scope dekez_chat_private.scopes; tenancy public.tenancies; bill public.rent_bills;
 agreement public.tenancy_agreements; ticket public.maintenance_tickets; n integer; body text; source uuid;
 today date:=(clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date; confirmed numeric;
 unclear text:='I’m not certain which record you are referring to. I’ve marked this conversation for Admin to review and reply.';
begin
 if p_intent='complaint' then return jsonb_build_object('body','Thank you for letting us know. I’ve marked this conversation for Management review so the team can follow up with you.','escalate',true); end if;
 if p_intent='sensitive' then return jsonb_build_object('body','Your request requires Management review. I have marked this conversation for Admin follow-up.','escalate',true); end if;
 if p_intent not in ('rent_due','rent_amount','payment_status','already_paid','ta_sign','ta_expiry','maintenance') or p_intent is null then
  return jsonb_build_object('body',unclear,'escalate',true); end if;
 select * into parties from dekez_chat_private.assistant_parties(p_conversation);
 if not found then return jsonb_build_object('body',unclear,'escalate',true); end if;
 select * into scope from dekez_chat_private.scopes where id=parties.scope_id;
 select count(*) into n from public.tenancies t join public.tenants person on person.id=t.tenant_id
 where person.profile_id=parties.tenant_id and t.status::text='active' and t.checkout_date is null
 and coalesce(t.billing_status::text,'') not in ('terminated','completed','cancelled','checked_out')
 and (scope.tenancy_id is null or scope.tenancy_id=t.id) and (scope.property_id is null or scope.property_id=t.property_id)
 and (scope.room_id is null or scope.room_id=t.room_id)
 and (scope.desk_id is null or t.company_id=(select d.company_id from dekez_chat_private.desks d where d.id=scope.desk_id));
 if n<>1 then return jsonb_build_object('body',unclear,'escalate',true); end if;
 select t.* into tenancy from public.tenancies t join public.tenants person on person.id=t.tenant_id
 where person.profile_id=parties.tenant_id and t.status::text='active' and t.checkout_date is null
 and coalesce(t.billing_status::text,'') not in ('terminated','completed','cancelled','checked_out')
 and (scope.tenancy_id is null or scope.tenancy_id=t.id) and (scope.property_id is null or scope.property_id=t.property_id)
 and (scope.room_id is null or scope.room_id=t.room_id)
 and (scope.desk_id is null or t.company_id=(select d.company_id from dekez_chat_private.desks d where d.id=scope.desk_id)) for share of t;
 if p_intent in ('rent_due','rent_amount','payment_status','already_paid') then
  -- Answer only an unambiguous current-month visible invoice; never guess among
  -- old debts, multiple rooms, future bills, hidden/cancelled records or deposits.
  select count(*) into n from public.rent_bills b where b.tenancy_id=tenancy.id and b.tenant_id=parties.tenant_id
   and b.property_id=tenancy.property_id and b.room_id=tenancy.room_id and b.tenant_facing and b.removed_at is null
   and b.status::text in ('unpaid','partially_paid','paid','pending_verification','payment_submitted')
   and date_trunc('month',b.due_date)=date_trunc('month',today);
  if n<>1 then return jsonb_build_object('body',unclear,'escalate',true); end if;
  select * into bill from public.rent_bills b where b.tenancy_id=tenancy.id and b.tenant_id=parties.tenant_id
   and b.property_id=tenancy.property_id and b.room_id=tenancy.room_id and b.tenant_facing and b.removed_at is null
   and b.status::text in ('unpaid','partially_paid','paid','pending_verification','payment_submitted')
   and date_trunc('month',b.due_date)=date_trunc('month',today) for share;
  source:=bill.id;
  if bill.amount is null or bill.paid_amount is null or bill.amount<bill.paid_amount or bill.paid_amount<0 then return jsonb_build_object('body',unclear,'escalate',true); end if;
  select coalesce(sum(p.amount),0) into confirmed from public.payments p where p.rent_bill_id=bill.id and p.status::text='confirmed' and p.reversed_at is null;
  if p_intent in ('payment_status','already_paid') then
   if exists(select 1 from public.payment_submissions p where p.rent_bill_id=bill.id and p.verification_status='pending_verification') then
    body:='Your payment submission for invoice '||coalesce(bill.invoice_number,'in your portal')||' has been received and is currently pending verification. You can check its status in your Tenant Portal.';
   elsif confirmed>0 then
    body:='A payment has been recorded for invoice '||coalesce(bill.invoice_number,'in your portal')||'. Please check the payment status and any remaining balance in your Tenant Portal.';
   else return jsonb_build_object('body',unclear,'escalate',true); end if;
  elsif confirmed>bill.paid_amount or exists(select 1 from public.payment_submissions p where p.rent_bill_id=bill.id and p.verification_status='pending_verification') then
   return jsonb_build_object('body',unclear,'escalate',true);
  elsif p_intent='rent_due' then
   body:='Your current invoice '||coalesce(bill.invoice_number,'in the Tenant Portal')||' has a due date of '||to_char(bill.due_date,'DD Mon YYYY')||'. Please check the invoice in your Tenant Portal for its payment status and full breakdown.';
  else
   -- Multiple outstanding periods must not be represented as one total.
   if exists(select 1 from public.rent_bills b where b.tenancy_id=tenancy.id and b.id<>bill.id and b.tenant_facing and b.removed_at is null and b.amount>b.paid_amount and b.status::text in ('unpaid','partially_paid')) then
    return jsonb_build_object('body',unclear,'escalate',true); end if;
   body:='The outstanding amount on your current invoice '||coalesce(bill.invoice_number,'in the Tenant Portal')||' is RM'||to_char(bill.amount-bill.paid_amount,'FM999999999990.00')||'. Please refer to the invoice for the full breakdown.';
  end if;
 elsif p_intent='ta_sign' then
  body:='Open your Tenant Portal and go to My Tenancy Agreements (E-Tenancy) to review and sign your available agreement.';
 elsif p_intent='ta_expiry' then
  select count(*) into n from public.tenancy_agreements a where a.tenancy_id=tenancy.id and a.admin_rejected_at is null and a.replacement_agreement_id is null
   and a.status::text in ('signed','renewal_signed') and a.term_start_date<=today
   and a.term_end_date=coalesce(tenancy.tenancy_end_date,tenancy.contract_end,tenancy.end_date);
  if n<>1 then return jsonb_build_object('body',unclear,'escalate',true); end if;
  select * into agreement from public.tenancy_agreements a where a.tenancy_id=tenancy.id and a.admin_rejected_at is null and a.replacement_agreement_id is null
   and a.status::text in ('signed','renewal_signed') and a.term_start_date<=today and a.term_end_date=coalesce(tenancy.tenancy_end_date,tenancy.contract_end,tenancy.end_date) for share;
  source:=agreement.id;body:='Your current signed tenancy agreement ends on '||to_char(agreement.term_end_date,'DD Mon YYYY')||'. Please review the agreement for the applicable renewal and notice terms.';
 elsif p_intent='maintenance' then
  if exists(select 1 from public.maintenance_tickets t where t.tenant_id=tenancy.tenant_id and t.property_id=tenancy.property_id and t.room_id=tenancy.room_id
   and (t.status is null or t.status::text not in ('submitted','assigned','in_progress','waiting_for_parts','completed','closed','cancelled','rejected'))) then
   return jsonb_build_object('body',unclear,'escalate',true); end if;
  select count(*) into n from public.maintenance_tickets t where t.tenant_id=tenancy.tenant_id and t.property_id=tenancy.property_id and t.room_id=tenancy.room_id and t.status::text not in ('completed','closed','cancelled','rejected');
  if n>1 then return jsonb_build_object('body',unclear,'escalate',true); end if;
  if n=1 then
   select * into ticket from public.maintenance_tickets t where t.tenant_id=tenancy.tenant_id and t.property_id=tenancy.property_id and t.room_id=tenancy.room_id and t.status::text not in ('completed','closed','cancelled','rejected') for share;
   source:=ticket.id;body:='Your existing maintenance ticket '||coalesce(ticket.ticket_number,'in the portal')||' is currently '||replace(ticket.status::text,'_',' ')||'. You can check this ticket in your Tenant Portal; there is no need to submit a duplicate for the same issue.';
  else body:='Please submit the maintenance issue through your Tenant Portal with a photo and description where possible. Management will review it and assign a contractor if required.'; end if;
 end if;
 return jsonb_build_object('body',body,'escalate',false,'source_id',source);
end; $$;

create function dekez_chat_private.assistant(p_action text,p_conversation uuid,p_token uuid,p_message uuid,p_intent text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='20s' as $$
declare state dekez_chat_private.assistant_state; config dekez_chat_private.assistant_control; parties record; m public.dekez_messages;
 answer jsonb; reply public.dekez_messages; original_sub text:=current_setting('request.jwt.claim.sub',true); outside boolean:=false;
 local_time timestamp:=clock_timestamp() at time zone 'Asia/Kuala_Lumpur'; result jsonb:='[]'; row record;
begin
 select * into config from dekez_chat_private.assistant_control where singleton;
 if p_action in ('status','pause','resume') then
  if not dekez_chat_private.can_read(p_conversation) then raise insufficient_privilege; end if;
  select * into parties from dekez_chat_private.assistant_parties(p_conversation);
  if parties.admin_id is distinct from auth.uid() then raise insufficient_privilege; end if;
  if p_action<>'status' then
   if not dekez_chat_private.can_start(parties.relationship_id) then raise insufficient_privilege; end if;
   insert into dekez_chat_private.assistant_state(conversation_id,mode) values(p_conversation,case when p_action='pause' then 'takeover' else 'active' end)
   on conflict(conversation_id) do update set mode=excluded.mode,pending_message=null,lease_token=null,lease_until=null,ai_answered=false,updated_at=now();
   insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(auth.uid(),'assistant_'||p_action,p_conversation,'Explicit participant control');
   update public.dekez_conversation_participants set updated_at=clock_timestamp() where conversation_id=p_conversation;
  end if;
  select * into state from dekez_chat_private.assistant_state where conversation_id=p_conversation;
  return jsonb_build_object('enabled',coalesce(config.enabled,false),'mode',coalesce(state.mode,'active'),'needs_admin_reply',coalesce(state.needs_admin_reply,false),'ai_answered',coalesce(state.ai_answered,false));
 end if;
 if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then raise insufficient_privilege; end if;
 if not coalesce(config.enabled,false) then return jsonb_build_object('disabled',true); end if;
 if p_action='claim' then
  for row in select s.* from dekez_chat_private.assistant_state s where s.mode='active' and s.pending_message is not null
   and s.due_at<=clock_timestamp() and (s.lease_until is null or s.lease_until<clock_timestamp()) order by s.due_at,s.conversation_id limit 5 for update skip locked loop
   select * into parties from dekez_chat_private.assistant_parties(row.conversation_id);
   if parties.admin_id is null then
    update dekez_chat_private.assistant_state set pending_message=null,lease_token=null,lease_until=null where conversation_id=row.conversation_id; continue;
   end if;
   perform set_config('request.jwt.claim.sub',parties.admin_id::text,true);
   if not dekez_chat_private.can_read(row.conversation_id) or not dekez_chat_private.can_start(parties.relationship_id) then
    update dekez_chat_private.assistant_state set pending_message=null,lease_token=null,lease_until=null where conversation_id=row.conversation_id; continue;
   end if;
   select * into m from public.dekez_messages where id=row.pending_message and sender_id=parties.tenant_id and message_type='USER_MESSAGE';
   if m.id is null then
    update dekez_chat_private.assistant_state set pending_message=null,lease_token=null,lease_until=null where conversation_id=row.conversation_id; continue;
   end if;
   update dekez_chat_private.assistant_state set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '2 minutes' where conversation_id=row.conversation_id returning * into state;
   result:=result||jsonb_build_array(jsonb_build_object('conversation',row.conversation_id,'message',m.id,'token',state.lease_token,'question',m.body));
  end loop;
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true); return result;
 end if;
 if p_action<>'finish' then raise exception 'Invalid assistant operation.'; end if;
 -- Conversation lock serializes with manual sends; recheck lease, latest message,
 -- relationship, and actual data at the moment of reply, not at model-call time.
 perform 1 from dekez_chat_private.relationships where id=(select relationship_id from public.dekez_conversations where id=p_conversation) for share;
 perform 1 from public.dekez_conversations where id=p_conversation for update;
 select * into state from dekez_chat_private.assistant_state where conversation_id=p_conversation for update;
 if state.mode is distinct from 'active' or state.lease_token is distinct from p_token or p_token is null
 or state.pending_message is distinct from p_message or state.lease_until<clock_timestamp() then return jsonb_build_object('skipped',true); end if;
 select * into parties from dekez_chat_private.assistant_parties(p_conversation);
 if parties.admin_id is null then return jsonb_build_object('skipped',true); end if;
 perform set_config('request.jwt.claim.sub',parties.admin_id::text,true);
 if not dekez_chat_private.can_read(p_conversation) or not dekez_chat_private.can_start(parties.relationship_id) then
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true); return jsonb_build_object('skipped',true); end if;
 select * into m from public.dekez_messages where id=p_message and conversation_id=p_conversation and sender_id=parties.tenant_id and message_type='USER_MESSAGE';
 if m.seq is distinct from (select message_count from public.dekez_conversations where id=p_conversation) then
  update dekez_chat_private.assistant_state set pending_message=null,lease_token=null,lease_until=null where conversation_id=p_conversation;
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true); return jsonb_build_object('skipped',true); end if;
 if exists(select 1 from dekez_chat_private.assistant_deliveries where request_message=p_message) then
  perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);return jsonb_build_object('skipped',true); end if;
 -- A burst of different unanswered messages may contain an earlier complaint or
 -- decision request. Never answer just the last question and silently drop it.
 if (select count(*) from public.dekez_messages pending where pending.conversation_id=p_conversation and pending.sender_id=parties.tenant_id
  and pending.message_type='USER_MESSAGE' and pending.seq>coalesce((select max(handled.seq) from public.dekez_messages handled
   where handled.conversation_id=p_conversation and handled.message_type in ('MANUAL_ADMIN','AI_ASSISTANT')),0))>1 then p_intent:='unclear'; end if;
 answer:=dekez_chat_private.assistant_answer(p_conversation,p_intent);
 if config.office_start is not null then outside:=not(extract(dow from local_time)::integer=any(config.office_days) and local_time::time>=config.office_start and local_time::time<config.office_end); end if;
 if outside and (state.after_hours_at is null or state.after_hours_at<clock_timestamp()-interval '24 hours') then
  answer:=jsonb_set(answer,'{body}',to_jsonb('Hi, we have received your message. DEKEZ Assistant can help with basic rental, payment, tenancy and maintenance information. Requests requiring Management review will be passed to Admin.'||chr(10)||chr(10)||(answer->>'body')));
 end if;
 reply:=dekez_chat_private.send(p_conversation,answer->>'body',p_message);
 update public.dekez_messages set message_type='AI_ASSISTANT',system_label='DEKEZ Assistant' where id=reply.id;
 insert into dekez_chat_private.assistant_deliveries(request_message,reply_message,conversation_id,intent,outcome,source_id,sender_id)
 values(p_message,reply.id,p_conversation,coalesce(p_intent,'unclear'),case when (answer->>'escalate')::boolean then 'escalated' else 'answered' end,(answer->>'source_id')::uuid,parties.admin_id);
 update dekez_chat_private.assistant_state set pending_message=null,lease_token=null,lease_until=null,
  mode=case when (answer->>'escalate')::boolean then 'escalated' else 'active' end,needs_admin_reply=(answer->>'escalate')::boolean,
  ai_answered=not (answer->>'escalate')::boolean,after_hours_at=case when outside and (state.after_hours_at is null or state.after_hours_at<clock_timestamp()-interval '24 hours') then clock_timestamp() else after_hours_at end,updated_at=now() where conversation_id=p_conversation;
 insert into dekez_chat_private.audit(actor_id,action,record_id,reason) values(parties.admin_id,'assistant_reply',reply.id,'Automated / '||coalesce(p_intent,'unclear')||' / request '||p_message::text);
 perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
 return jsonb_build_object('sent',true,'escalated',(answer->>'escalate')::boolean);
exception when others then
 perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);raise;
end; $$;
create function public.dekez_chat_assistant(p_action text,p_conversation uuid default null,p_token uuid default null,p_message uuid default null,p_intent text default null) returns jsonb
language sql security invoker set search_path='' as $$select dekez_chat_private.assistant(p_action,p_conversation,p_token,p_message,p_intent)$$;
revoke all on function dekez_chat_private.assistant_parties(uuid),dekez_chat_private.assistant_message_event(),dekez_chat_private.assistant_answer(uuid,text),
 dekez_chat_private.assistant(text,uuid,uuid,uuid,text),public.dekez_chat_assistant(text,uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function dekez_chat_private.assistant(text,uuid,uuid,uuid,text),public.dekez_chat_assistant(text,uuid,uuid,uuid,text) to authenticated,service_role;

-- Preserve the existing gateway verbatim except this narrowly authorized RPC.
alter function dekez_chat_private.check_request() rename to check_request_before_assistant;
create function dekez_chat_private.check_request() returns void language plpgsql security definer set search_path='' as $$
begin
 if trim(both '/' from coalesce(current_setting('request.path',true),''))='rpc/dekez_chat_assistant'
 and current_setting('request.method',true)='POST' and dekez_chat_private.current_member() then return; end if;
 perform dekez_chat_private.check_request_before_assistant();
end; $$;
revoke all on function dekez_chat_private.check_request() from public,anon;
grant execute on function dekez_chat_private.check_request() to authenticated,service_role;

create or replace function dekez_chat_private.inbox(p_before timestamptz,p_before_id uuid,p_limit integer,p_filter text)
returns table(conversation_id uuid,status text,last_message_at timestamptz,unread_count bigint,preview text,contact_name text,
 contact_role text,property_name text,ticket_number text,latest_message_type text,needs_reply boolean,message_time timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not dekez_chat_private.current_member() then raise insufficient_privilege; end if;
 if p_filter is null or p_filter not in ('all','unread','tenant','owner','contractor','automated','needs_reply','ai_answered') then raise exception 'Invalid inbox filter.'; end if;
 return query select c.id,case when c.status='closed' or not dekez_chat_private.can_start(r.id) then 'closed' else 'active' end,
 p.updated_at,p.unread_count,left(m.body,160),dekez_chat_private.contact_label(s.id,other.user_id),other.chat_role,
 coalesce(property.name,d.label,'DEKEZ'),t.ticket_number,m.message_type,
 coalesce(state.needs_admin_reply,false) or (not coalesce(state.ai_answered,false) and coalesce(m.sender_id<>auth.uid() and p.unread_count>0 and (m.message_type='USER_MESSAGE' or (m.message_type is null and other.chat_role not in ('admin','management'))),false)),c.last_message_at
 from public.dekez_conversation_participants p join public.dekez_conversations c on c.id=p.conversation_id
 join dekez_chat_private.relationships r on r.id=c.relationship_id join dekez_chat_private.scopes s on s.id=r.scope_id
 join dekez_chat_private.members other on other.user_id=case when r.user_a=auth.uid() then r.user_b else r.user_a end
 left join public.properties property on property.id=s.property_id left join dekez_chat_private.desks d on d.id=s.desk_id
 left join public.maintenance_tickets t on t.id=s.maintenance_ticket_id
 left join public.dekez_messages m on m.conversation_id=c.id and m.seq=c.message_count
 left join dekez_chat_private.assistant_state state on state.conversation_id=c.id and other.chat_role='tenant'
 where p.user_id=(select auth.uid()) and dekez_chat_private.can_read(c.id)
 and (p_before is null or (p.updated_at,c.id)<(p_before,coalesce(p_before_id,'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
 and (p_filter='all' or (p_filter='unread' and p.unread_count>0) or p_filter=other.chat_role
 or (p_filter='needs_reply' and (coalesce(state.needs_admin_reply,false) or (not coalesce(state.ai_answered,false) and p.unread_count>0 and m.sender_id<>auth.uid() and (m.message_type='USER_MESSAGE' or (m.message_type is null and other.chat_role not in ('admin','management'))))))
 or (p_filter='ai_answered' and state.ai_answered)
 or (p_filter='automated' and exists(select 1 from public.dekez_messages a where a.conversation_id=c.id and a.message_type='AUTO_REMINDER')))
 order by p.updated_at desc,c.id desc limit greatest(1,least(coalesce(p_limit,25),50));
end; $$;
notify pgrst,'reload schema';
commit;
