-- Chat reminders only. No financial/tenancy writes, chat grants, or WhatsApp changes.
-- Installation is inert: both database and deployment switches start disabled.
begin;

create table dekez_chat_private.reminder_control (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 cursor_day date,
 cursor_key text,
 updated_at timestamptz not null default now()
);
insert into dekez_chat_private.reminder_control(singleton) values(true);

-- Existing TAs have no structured signing/notice deadline. Never substitute
-- agreement_notifications.due_at (dispatch time), term start, or template defaults.
-- Optional reviewed facts, not new agreement terms. No client write endpoint.
create table dekez_chat_private.agreement_reminder_deadlines (
 agreement_id uuid not null references public.tenancy_agreements(id),
 reminder_type text not null check(reminder_type in ('ta_signing','renewal_notice','auto_renewal')),
 deadline date not null,
 source_clause text not null check(length(trim(source_clause)) between 20 and 2000),
 agreement_fingerprint text not null,
 verified_by uuid not null references public.profiles(id),
 verified_at timestamptz not null default now(),
 enabled boolean not null default true,
 primary key(agreement_id,reminder_type)
);
create table dekez_chat_private.reminder_deliveries (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.profiles(id),
 tenancy_id uuid not null references public.tenancies(id),
 invoice_id uuid references public.rent_bills(id),
 agreement_id uuid references public.tenancy_agreements(id),
 source_key text not null,
 reminder_type text not null check(reminder_type in ('rental','ta_signing','ta_expiry','renewal_notice','auto_renewal')),
 stage text not null check(stage in ('7-day','3-day','1-day','deadline','overdue')),
 deadline date not null,
 message_id uuid not null unique references public.dekez_messages(id),
 conversation_id uuid not null references public.dekez_conversations(id),
 sender_id uuid not null references public.profiles(id),
 sent_at timestamptz not null default now(),
 check((invoice_id is null)<>(agreement_id is null)),
 unique(tenant_id,source_key,stage)
);
create table dekez_chat_private.reminder_runs (
 id bigint generated always as identity primary key,
 ran_at timestamptz not null default now(),
 local_day date not null,
 examined integer not null,
 sent integer not null,
 skipped integer not null,
 failed integer not null,
 next_cursor text
);
alter table dekez_chat_private.reminder_control enable row level security;
alter table dekez_chat_private.agreement_reminder_deadlines enable row level security;
alter table dekez_chat_private.reminder_deliveries enable row level security;
alter table dekez_chat_private.reminder_runs enable row level security;
revoke all on dekez_chat_private.reminder_control,dekez_chat_private.agreement_reminder_deadlines,
 dekez_chat_private.reminder_deliveries,dekez_chat_private.reminder_runs from public,anon,authenticated,service_role;

-- Only this restricted worker can set the system label; ordinary send APIs never accept it.
alter table public.dekez_messages add column system_label text check(system_label is null or system_label='DEKEZ Admin');

create function dekez_chat_private.reminder_stage(p_deadline date,p_day date) returns text
language sql immutable set search_path='' as $$
 select case p_deadline-p_day when 7 then '7-day' when 3 then '3-day' when 1 then '1-day'
 when 0 then 'deadline' else case when p_deadline<p_day then 'overdue' end end;
$$;

create function dekez_chat_private.validate_reminder_deadline() returns trigger
language plpgsql security definer set search_path='' as $$
declare content text;
begin
 select rendered_content into content from public.tenancy_agreements where id=new.agreement_id;
 if content is null or new.agreement_fingerprint<>md5(content)
 or strpos(content,new.source_clause)=0 or not exists(select 1 from public.profiles
 where id=new.verified_by and role::text='super_admin' and registration_status::text='approved') then
 raise exception 'A reviewed deadline must reference the exact saved agreement clause and version.';
 end if;
 if new.reminder_type='auto_renewal' and (new.source_clause !~* 'auto.?renew|automatically.*renew'
 or content ~* 'renewal is not automatic|does not automatically renew|will not automatically renew') then
 raise exception 'This agreement does not support an automatic renewal warning.';
 end if;
 return new;
end; $$;
create trigger dekez_reminder_deadline_validate before insert or update on dekez_chat_private.agreement_reminder_deadlines
 for each row execute function dekez_chat_private.validate_reminder_deadline();

-- Read-only projection of authoritative sources. Never infer an identity by name,
-- phone, room alone, or a dispatch timestamp. Unlinked legacy bills are skipped.
create view dekez_chat_private.reminder_sources as
with active as (
 select t.*,person.profile_id as recipient from public.tenancies t
 join public.tenants person on person.id=t.tenant_id
 where t.status::text='active' and t.checkout_date is null
 and coalesce(t.billing_status::text,'') not in ('terminated','completed','cancelled','checked_out')
), agreements as (
 select a.*,t.recipient,t.property_id,t.company_id,
 coalesce(t.tenancy_end_date,t.contract_end,t.end_date) as current_end
 from public.tenancy_agreements a join active t on t.id=a.tenancy_id
 where a.admin_rejected_at is null and a.replacement_agreement_id is null
 and a.status::text not in ('cancelled','rejected','superseded','void')
)
select 'rental:'||b.id::text as source_key,'rental'::text as reminder_type,b.id as invoice_id,
 null::uuid as agreement_id,t.id as tenancy_id,t.recipient as tenant_id,t.property_id,t.company_id,
 b.due_date as deadline,b.amount as invoice_amount,b.amount-b.paid_amount as outstanding,
 coalesce(b.invoice_number,b.id::text) as reference,null::text as clause
from public.rent_bills b join active t on t.id=b.tenancy_id and t.recipient=b.tenant_id
where b.tenant_facing and b.removed_at is null and b.status::text in ('unpaid','partially_paid')
 and b.amount>b.paid_amount and b.due_date is not null and b.property_id=t.property_id
 and b.room_id=t.room_id
 and not exists(select 1 from public.payment_submissions p where p.rent_bill_id=b.id
 and p.verification_status='pending_verification')
 -- Avoid an incorrect nag while an already-confirmed payment awaits balance refresh.
 and coalesce((select sum(p.amount) from public.payments p where p.rent_bill_id=b.id
 and p.status::text='confirmed' and p.reversed_at is null),0)<=b.paid_amount
union all
select 'ta_expiry:'||a.id::text,'ta_expiry',null::uuid,a.id,a.tenancy_id,a.recipient,a.property_id,a.company_id,
 a.term_end_date,null::numeric,null::numeric,'Agreement version '||a.version_number::text,null::text
from agreements a
where a.term_end_date=a.current_end and (a.signed_at is not null or a.status::text in ('signed','renewal_signed'))
 and not exists(select 1 from public.tenancy_renewals r where r.tenancy_id=a.tenancy_id
 and r.new_start_date=a.term_end_date+1 and (r.decision_status in ('renew','not_renew')
 or r.renewal_status in ('renewal_approved','not_renewing','completed')))
 and not exists(select 1 from public.tenancy_agreements n where n.tenancy_id=a.tenancy_id
 and n.term_start_date=a.term_end_date+1 and n.signed_at is not null
 and n.admin_rejected_at is null and n.replacement_agreement_id is null)
union all
select d.reminder_type||':'||a.id::text,d.reminder_type,null::uuid,a.id,a.tenancy_id,a.recipient,a.property_id,a.company_id,
 d.deadline,null::numeric,null::numeric,'Agreement version '||a.version_number::text,d.source_clause
from agreements a join dekez_chat_private.agreement_reminder_deadlines d on d.agreement_id=a.id
where d.enabled and d.agreement_fingerprint=md5(a.rendered_content)
 and strpos(a.rendered_content,d.source_clause)>0
 and (d.reminder_type='ta_signing' and a.signed_at is null and a.status::text not in ('signed','renewal_signed')
 or d.reminder_type in ('renewal_notice','auto_renewal') and a.term_end_date=a.current_end
 and not exists(select 1 from public.tenancy_renewals r where r.tenancy_id=a.tenancy_id
 and r.new_start_date=a.term_end_date+1 and (r.decision_status in ('renew','not_renew')
 or r.renewal_status in ('renewal_approved','not_renewing','completed')))
 and not exists(select 1 from public.tenancy_agreements n where n.tenancy_id=a.tenancy_id
 and n.term_start_date=a.term_end_date+1 and n.signed_at is not null
 and n.admin_rejected_at is null and n.replacement_agreement_id is null));
revoke all on dekez_chat_private.reminder_sources from public,anon,authenticated,service_role;

-- Select existing conversation only. No enrollment, grant, or conversation creation.
-- Prefer an exact tenancy/property chat; the company-scoped Admin desk is fallback.
create function dekez_chat_private.reminder_conversation(p_tenant uuid,p_tenancy uuid,p_property uuid,p_company uuid)
returns table(conversation_id uuid,sender_id uuid,relationship_id uuid)
language sql stable set search_path='' as $$
 select c.id,m.user_id,r.id from public.dekez_conversation_participants tenant
 join public.dekez_conversations c on c.id=tenant.conversation_id
 join public.dekez_conversation_participants staff on staff.conversation_id=c.id and staff.user_id<>tenant.user_id
 join dekez_chat_private.members m on m.user_id=staff.user_id and m.chat_role='admin' and m.enabled
 join public.profiles p on p.id=m.user_id and p.role::text=m.profile_role and p.registration_status::text='approved'
 join dekez_chat_private.relationships r on r.id=c.relationship_id
 join dekez_chat_private.scopes s on s.id=r.scope_id
 left join dekez_chat_private.desks d on d.id=s.desk_id
 where tenant.user_id=p_tenant and c.status='active' and r.status='active' and s.closed_at is null
 and (r.expires_at is null or r.expires_at>now())
 and p_tenant in(r.user_a,r.user_b) and m.user_id in(r.user_a,r.user_b)
 and ((s.kind='property' and s.property_id=p_property and (s.tenancy_id is null or s.tenancy_id=p_tenancy))
 or (s.kind='contact_desk' and d.company_id=p_company and d.staff_id=m.user_id and d.enabled))
 order by (s.tenancy_id=p_tenancy) desc nulls last,(s.property_id=p_property) desc nulls last,c.created_at,c.id
 limit 1;
$$;

create function dekez_chat_private.reminder_body(s dekez_chat_private.reminder_sources,p_stage text) returns text
language plpgsql immutable set search_path='' as $$
declare heading text; action text;
begin
 heading:=case s.reminder_type when 'rental' then case when p_stage='overdue' then 'Rental overdue' else 'Rental payment due' end
 when 'ta_signing' then 'Tenancy Agreement signature required' when 'ta_expiry' then 'Tenancy Agreement expiry'
 when 'renewal_notice' then 'Tenancy renewal action required' when 'auto_renewal' then 'Agreement auto-renewal warning' end;
 action:=case s.reminder_type when 'rental' then format('Invoice %s. Invoice amount: RM%s. Remaining unpaid: RM%s. Please check Bills or reply here if you need help.',s.reference,to_char(s.invoice_amount,'FM999999999990.00'),to_char(s.outstanding,'FM999999999990.00'))
 when 'ta_signing' then 'Please review and sign your Tenancy Agreement, or reply here for assistance.'
 when 'ta_expiry' then 'Please contact DEKEZ Admin about your agreement expiry and any required renewal action. This reminder does not renew or change your tenancy.'
 else 'Please complete the required agreement action or reply here for assistance. This reminder does not renew or change your tenancy.' end;
 return 'DEKEZ Admin — '||heading||E'\n'||case when s.reminder_type='ta_expiry' then 'Expiry date: ' else 'Due / action deadline: ' end
 ||to_char(s.deadline,'DD Mon YYYY')||' ('||case p_stage when '7-day' then '7 days before' when '3-day' then '3 days before'
 when '1-day' then '1 day before' when 'deadline' then 'today' else 'overdue / action required' end||E').\n'||action
 ||case when s.clause is not null then E'\nYour saved agreement rule: '||s.clause else '' end;
end; $$;

-- Private implementation accepts a date for deterministic offline tests only.
-- No API/client/service EXECUTE grant; the scheduled wrapper supplies Malaysia today.
create function dekez_chat_private.reminder_batch(p_day date,p_preview boolean) returns jsonb
language plpgsql set search_path='' as $$
declare ctl dekez_chat_private.reminder_control; item record; s dekez_chat_private.reminder_sources;
 target record; v_stage text; message public.dekez_messages; last_key text; examined integer:=0;
 sent integer:=0; skipped integer:=0; failed integer:=0; ready integer:=0; duplicate integer:=0;
 original_sub text:=current_setting('request.jwt.claim.sub',true);
begin
 if not pg_try_advisory_xact_lock(hashtextextended('dekez-chat-tenant-reminders',0)) then return jsonb_build_object('busy',true); end if;
 select * into ctl from dekez_chat_private.reminder_control where singleton for update;
 if not found then return jsonb_build_object('disabled',true); end if;
 if not ctl.enabled and not p_preview then return jsonb_build_object('disabled',true); end if;
 if ctl.cursor_day is distinct from p_day or p_preview then ctl.cursor_key:=null; end if;
 for item in select v.source_key,v.tenancy_id,v.invoice_id,v.agreement_id from dekez_chat_private.reminder_sources v
 where v.deadline<=p_day+7 and dekez_chat_private.reminder_stage(v.deadline,p_day) is not null
 and (ctl.cursor_key is null or v.source_key>ctl.cursor_key)
 order by v.source_key limit 50
 loop
  examined:=examined+1; last_key:=item.source_key;
  begin
   -- Short row locks serialize with checkout, signature, payment verification,
   -- and FK-linked submissions/renewal inserts; sources are reread after locking.
   perform 1 from public.tenancies where id=item.tenancy_id for update;
   if item.invoice_id is not null then
    perform 1 from public.rent_bills where id=item.invoice_id for update;
    perform 1 from public.payment_submissions where rent_bill_id=item.invoice_id for share;
    perform 1 from public.payments where rent_bill_id=item.invoice_id for share;
   else
    perform 1 from public.tenancy_agreements where tenancy_id=item.tenancy_id for share;
    perform 1 from public.tenancy_renewals where tenancy_id=item.tenancy_id for share;
    perform 1 from dekez_chat_private.agreement_reminder_deadlines where agreement_id=item.agreement_id for share;
   end if;
   select * into s from dekez_chat_private.reminder_sources where source_key=item.source_key;
   if not found then skipped:=skipped+1; continue; end if;
   v_stage:=dekez_chat_private.reminder_stage(s.deadline,p_day);
   if v_stage is null then skipped:=skipped+1; continue; end if;
   if exists(select 1 from dekez_chat_private.reminder_deliveries d where d.tenant_id=s.tenant_id
    and d.source_key=s.source_key and d.stage=v_stage) then duplicate:=duplicate+1; continue; end if;
   select * into target from dekez_chat_private.reminder_conversation(s.tenant_id,s.tenancy_id,s.property_id,s.company_id);
   if not found then skipped:=skipped+1; continue; end if;
   -- Narrow service delegation to the EXISTING Admin participant. Reuse the
   -- unmodified normal send authorization, rate limit, counters and realtime triggers.
   -- No caller can supply the sender, recipient, conversation, body, date, or grant.
   perform set_config('request.jwt.claim.sub',target.sender_id::text,true);
   if not dekez_chat_private.can_read(target.conversation_id) or not dekez_chat_private.can_start(target.relationship_id) then
    perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true); skipped:=skipped+1; continue;
   end if;
   ready:=ready+1;
   if not p_preview then
    message:=dekez_chat_private.send(target.conversation_id,dekez_chat_private.reminder_body(s,v_stage),gen_random_uuid());
    update public.dekez_messages set system_label='DEKEZ Admin' where id=message.id;
    insert into dekez_chat_private.reminder_deliveries(tenant_id,tenancy_id,invoice_id,agreement_id,source_key,reminder_type,
     stage,deadline,message_id,conversation_id,sender_id)
    values(s.tenant_id,s.tenancy_id,s.invoice_id,s.agreement_id,s.source_key,s.reminder_type,v_stage,s.deadline,message.id,target.conversation_id,target.sender_id);
    insert into dekez_chat_private.audit(actor_id,action,record_id,reason)
    values(target.sender_id,'tenant_reminder_sent',message.id,s.source_key||' / '||v_stage);
    sent:=sent+1;
   end if;
   perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
  exception when others then
   -- Subtransaction rolls back message, counters, signal and dedupe row together.
   perform set_config('request.jwt.claim.sub',coalesce(original_sub,''),true);
   failed:=failed+1;
   if not p_preview then
    insert into dekez_chat_private.audit(actor_id,action,record_id,reason)
    values(null,'tenant_reminder_failed',coalesce(item.invoice_id,item.agreement_id),item.source_key||' / SQLSTATE '||sqlstate);
   end if;
  end;
 end loop;
 if not p_preview then
  update dekez_chat_private.reminder_control set cursor_day=p_day,cursor_key=case when examined=50 then last_key end,updated_at=now() where singleton;
  insert into dekez_chat_private.reminder_runs(local_day,examined,sent,skipped,failed,next_cursor)
  values(p_day,examined,sent,skipped,failed,case when examined=50 then last_key end);
 end if;
 return jsonb_build_object('preview',p_preview,'day',p_day,'examined',examined,'ready',ready,'sent',sent,
 'skipped',skipped,'already_sent',duplicate,'failed',failed,'more',examined=50);
end; $$;

create function dekez_chat_private.scheduled_reminders(p_preview boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='2s' set statement_timeout='20s' as $$
begin
 if coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'role' is distinct from 'service_role' then
 raise insufficient_privilege using message='Reminder worker access only.'; end if;
 return dekez_chat_private.reminder_batch((clock_timestamp() at time zone 'Asia/Kuala_Lumpur')::date,coalesce(p_preview,true));
end; $$;
create function public.dekez_chat_reminders(p_preview boolean default true) returns jsonb
language sql security invoker set search_path='' as $$select dekez_chat_private.scheduled_reminders(p_preview)$$;

revoke all on function dekez_chat_private.reminder_stage(date,date),dekez_chat_private.validate_reminder_deadline(),
 dekez_chat_private.reminder_conversation(uuid,uuid,uuid,uuid),
 dekez_chat_private.reminder_body(dekez_chat_private.reminder_sources,text),dekez_chat_private.reminder_batch(date,boolean),
 dekez_chat_private.scheduled_reminders(boolean),public.dekez_chat_reminders(boolean) from public,anon,authenticated,service_role;
grant usage on schema dekez_chat_private to service_role;
grant execute on function dekez_chat_private.scheduled_reminders(boolean),public.dekez_chat_reminders(boolean) to service_role;
notify pgrst,'reload schema';
commit;
