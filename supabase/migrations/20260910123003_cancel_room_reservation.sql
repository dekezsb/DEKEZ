create or replace function public.cancel_room_reservation(p_application uuid,p_actor uuid,p_reason text)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.tenant_applications%rowtype;
begin
 if nullif(btrim(p_reason),'') is null or p_actor is null then raise exception 'Cancellation reason required'; end if;
 select * into strict a from public.tenant_applications where id=p_application for update;
 perform 1 from public.rooms where id=a.room_id for update;
 if a.registration_mode<>'reservation' or a.status not in ('submitted','approved','pending_verification')
   or exists(select 1 from public.tenancies where tenant_application_id=a.id) then raise exception 'Reservation unavailable'; end if;
 insert into public.audit_logs(action,entity_table,entity_id,metadata) values('reservation_cancelled','tenant_applications',a.id,
 jsonb_build_object('actor',p_actor,'reason',p_reason,'original_application',to_jsonb(a),'payments_retained',true));
 update public.tenant_applications set status='rejected',verification_status='rejected',reviewed_by=p_actor,reviewed_at=now(),
 admin_notes=concat_ws(E'\n',admin_notes,'Reservation cancelled: '||p_reason),updated_at=now() where id=a.id;
 update public.rooms set status='vacant',updated_at=now() where id=a.room_id and status='reserved' and current_tenancy_id is null
 and not exists(select 1 from public.tenancies where room_id=a.room_id and status='active')
 and not exists(select 1 from public.tenant_applications where room_id=a.room_id and id<>a.id and status in ('submitted','approved','pending_verification'));
end;
$$;
revoke all on function public.cancel_room_reservation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_room_reservation(uuid,uuid,text) to service_role;
