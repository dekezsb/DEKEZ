-- A staff-assisted reservation exists before a tenant login/record. Link its
-- pending payment and attachment to that application instead of inventing a tenant.
alter table public.payment_attachments add column tenant_application_id uuid references public.tenant_applications(id) on delete set null;
alter table public.payment_submissions drop constraint payment_submissions_has_tenant_source;
alter table public.payment_submissions add constraint payment_submissions_has_tenant_source
  check (tenant_id is not null or tenant_record_id is not null or (tenant_application_id is not null and bill_type='check_in'));
alter table public.payment_attachments drop constraint payment_attachments_has_tenant_source;
alter table public.payment_attachments add constraint payment_attachments_has_tenant_source
  check (tenant_id is not null or tenant_record_id is not null or tenant_application_id is not null);
create index payment_attachments_tenant_application_idx on public.payment_attachments(tenant_application_id) where tenant_application_id is not null;

-- One reservation deposit/slip, submitted atomically. No tenant receipt,
-- tenancy, rent invoice, payment verification or journal is created here.
create or replace function public.submit_reservation_deposit(
  p_application uuid, p_actor uuid, p_amount numeric, p_date date,
  p_path text, p_file_name text, p_content_type text, p_note text default ''
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  a public.tenant_applications%rowtype;
  r public.rooms%rowtype;
  existing public.payment_submissions%rowtype;
  payment_id uuid;
  property_code text;
begin
  select * into strict a from public.tenant_applications where id=p_application for update;
  if p_actor is null or not (coalesce(a.tenant_id=p_actor,false) or coalesce(a.submitted_by=p_actor,false))
    or a.registration_mode <> 'reservation' then raise exception 'Reservation not available to this actor'; end if;
  select p.property_code into property_code from public.properties p where p.id=a.property_id and p.status='active';
  if property_code is null or upper(property_code) in ('BDS','PTT') then raise exception 'Reservations unavailable'; end if;
  if p_amount is null or p_amount<=0 or p_amount>1000000 or p_amount<>round(p_amount,2)
    or p_date is null or nullif(btrim(p_path),'') is null or nullif(btrim(p_file_name),'') is null
    or p_content_type not in ('image/jpeg','image/png','image/webp','application/pdf')
    or p_content_type is null or position(p_actor::text||'/' in p_path)<>1
    or position('/'||a.id::text||'/' in p_path)=0 then raise exception 'Invalid reservation deposit slip'; end if;
  select * into existing from public.payment_submissions where submission_key=a.id;
  if found then
    if existing.tenant_application_id<>a.id or existing.amount<>p_amount or existing.payment_date<>p_date
      or a.status not in ('submitted','pending_verification','approved') then raise exception 'Existing reservation payment requires review'; end if;
    return existing.id;
  end if;
  if a.status not in ('draft','submitted') or exists(select 1 from public.payment_submissions where tenant_application_id=a.id)
    then raise exception 'Existing reservation requires review'; end if;
  select * into strict r from public.rooms where id=a.room_id and property_id=a.property_id for update;
  if r.status not in ('vacant','reserved') or r.current_tenancy_id is not null
    or exists(select 1 from public.tenancies where room_id=r.id and status='active')
    or exists(select 1 from public.tenant_applications where room_id=r.id and id<>a.id and status in ('submitted','approved','pending_verification'))
    then raise exception 'Room no longer available'; end if;
  insert into public.payment_submissions(tenant_application_id,tenant_id,property_id,unit_id,room_id,bill_type,payment_type,amount,payment_date,payment_method,receipt_url,verification_status,instalment,submission_key,payment_note)
  values(a.id,a.tenant_id,a.property_id,a.unit_id,a.room_id,'check_in','rent_and_deposit',p_amount,p_date,'online_payment',p_path,'pending_verification',true,a.id,
    'Reservation deposit (room-holding payment). Main account must verify and allocate against the check-in balance. '||coalesce(p_note,'')) returning id into payment_id;
  insert into public.payment_attachments(payment_submission_id,tenant_id,tenant_application_id,file_path,file_name,content_type)
  values(payment_id,a.tenant_id,a.id,p_path,p_file_name,p_content_type);
  update public.rooms set status='reserved',updated_at=now() where id=r.id;
  update public.tenant_applications set status='submitted',verification_status='pending_verification',payment_status='pending_verification',
    submitted_at=coalesce(submitted_at,now()),updated_at=now(),
    admin_notes=concat_ws(E'\n',nullif(admin_notes,''),'Reservation deposit submitted: RM '||p_amount::text||' on '||p_date::text||'. Awaiting verification; tenant has not checked in.') where id=a.id;
  return payment_id;
end;
$$;
revoke all on function public.submit_reservation_deposit(uuid,uuid,numeric,date,text,text,text,text) from public,anon,authenticated;
grant execute on function public.submit_reservation_deposit(uuid,uuid,numeric,date,text,text,text,text) to service_role;
