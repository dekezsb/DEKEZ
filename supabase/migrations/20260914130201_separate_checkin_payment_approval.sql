-- Admin check-in approval and bank payment verification are independent.
-- Keep the monthly-stay model and approved, matching registration safeguards.
create or replace function public.enforce_monthly_stay_tenancy()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  selected_model text;
  application_ready boolean;
begin
  if tg_op = 'UPDATE' then
    selected_model := old.rental_model;
    application_ready := true;
    new.tenant_application_id := old.tenant_application_id;
  elsif new.tenant_application_id is not null then
    select a.rental_model,
      a.verification_status = 'verified'
      and a.registration_mode = 'check_in'
      and a.status in ('approved', 'converted_to_tenancy')
      and a.property_id = new.property_id
      and a.room_id = new.room_id
    into selected_model, application_ready
    from public.tenant_applications a
    where a.id = new.tenant_application_id;
  else
    select p.rental_model, false into selected_model, application_ready
    from public.properties p where p.id = new.property_id;
  end if;
  new.rental_model := coalesce(selected_model, 'tenancy');
  if new.rental_model = 'monthly_stay' then
    if new.tenant_application_id is null or not coalesce(application_ready, false) then
      raise exception 'Monthly stay requires an approved check-in registration for this property and room. Payment is verified separately.';
    end if;
    new.deposit := 0;
    new.end_date := null;
    new.contract_end := null;
    new.tenancy_end_date := null;
    new.contract_duration_months := null;
  end if;
  return new;
end;
$$;

-- Reserve and approve together; a room conflict rolls back the approval.
create or replace function public.guard_reservation_approval()
returns trigger language plpgsql set search_path to 'public' as $$
declare selected_room public.rooms%rowtype;
begin
  if new.registration_mode = 'reservation' and new.verification_status = 'verified'
     and old.verification_status is distinct from 'verified' then
    select * into selected_room from public.rooms where id = new.room_id for update;
    if not found or selected_room.property_id is distinct from new.property_id
       or selected_room.current_tenancy_id is not null
       or selected_room.status not in ('vacant', 'reserved') then
      raise exception 'Room unavailable for reservation approval.';
    end if;
    if exists (select 1 from public.tenancies where room_id = new.room_id and status = 'active')
       or exists (select 1 from public.tenant_applications where room_id = new.room_id
         and id <> new.id and status = 'approved' and verification_status = 'verified') then
      raise exception 'Another approved tenant or reservation already holds this room.';
    end if;
    update public.rooms set status = 'reserved', updated_at = now() where id = new.room_id;
  end if;
  return new;
end;
$$;
create trigger guard_reservation_approval before update of verification_status
on public.tenant_applications for each row execute function public.guard_reservation_approval();
