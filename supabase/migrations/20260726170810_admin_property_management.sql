alter table public.properties
  add column if not exists is_commercial boolean not null default false;

alter table public.tenant_documents
  add column if not exists tenant_record_id uuid references public.tenant_records(id) on delete cascade;

alter table public.tenant_documents
  alter column tenant_application_id drop not null,
  alter column tenant_id drop not null;

alter table public.tenant_documents
  drop constraint if exists tenant_documents_document_type_check;

alter table public.tenant_documents
  add constraint tenant_documents_document_type_check
  check (
    document_type in (
      'ic_front',
      'ic_back',
      'passport_photo_page',
      'commercial_supporting_document'
    )
  );

alter table public.tenant_documents
  drop constraint if exists tenant_documents_context_check;

alter table public.tenant_documents
  add constraint tenant_documents_context_check
  check (
    tenant_application_id is not null
    or tenant_record_id is not null
  );

create index if not exists tenant_documents_tenant_record_id_idx
  on public.tenant_documents (tenant_record_id);

create or replace function public.can_manage_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.properties as properties
      join public.company_users as company_users
        on company_users.company_id = properties.company_id
      where properties.id = target_property_id
        and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
        and company_users.status::text = 'active'
        and company_users.role::text = 'admin_team'
    );
$$;

create or replace function public.can_access_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_manage_property(target_property_id)
    or public.owns_property(target_property_id)
    or exists (
      select 1
      from public.tenancies as tenancies
      left join public.tenants as tenants
        on tenants.id = tenancies.tenant_id
      where tenancies.property_id = target_property_id
        and (
          tenancies.tenant_id = auth.uid()
          or tenants.profile_id = auth.uid()
        )
    )
    or exists (
      select 1
      from public.maintenance_tickets as tickets
      join public.maintenance_ticket_assignments as assignments
        on assignments.ticket_id = tickets.id
      where tickets.property_id = target_property_id
        and assignments.assigned_to = auth.uid()
        and assignments.status::text <> 'cancelled'
    );
$$;

drop policy if exists "properties_insert_scope" on public.properties;
create policy "properties_insert_scope"
on public.properties
for insert
to authenticated
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.company_users as company_users
    where company_users.company_id = properties.company_id
      and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
      and company_users.status::text = 'active'
      and company_users.role::text = 'admin_team'
  )
);

drop policy if exists "company managers manage rooms" on public.rooms;
drop policy if exists "company members view rooms" on public.rooms;
drop policy if exists "rooms_portal_manage" on public.rooms;
drop policy if exists "rooms_portal_select" on public.rooms;

create policy "rooms_select_allowed"
on public.rooms
for select
to authenticated
using (
  public.can_access_property(property_id)
  or exists (
    select 1
    from public.tenancies as tenancies
    join public.tenants as tenants
      on tenants.id = tenancies.tenant_id
    where tenancies.room_id = rooms.id
      and tenants.profile_id = auth.uid()
  )
);

create policy "rooms_manage_admin"
on public.rooms
for all
to authenticated
using (public.can_manage_property(property_id))
with check (public.can_manage_property(property_id));

drop policy if exists "company managers manage units" on public.units;
drop policy if exists "company members view units" on public.units;
drop policy if exists "units_manage_admin_member" on public.units;
drop policy if exists "units_select_allowed" on public.units;

create policy "units_select_allowed"
on public.units
for select
to authenticated
using (public.can_access_property(property_id));

create policy "units_manage_admin"
on public.units
for all
to authenticated
using (public.can_manage_property(property_id))
with check (public.can_manage_property(property_id));

drop policy if exists "tenant_records_manage_allowed" on public.tenant_records;
create policy "tenant_records_manage_admin"
on public.tenant_records
for all
to authenticated
using (public.can_manage_property(property_id))
with check (public.can_manage_property(property_id));

drop policy if exists "tenant_applications_update_allowed" on public.tenant_applications;
create policy "tenant_applications_update_admin"
on public.tenant_applications
for update
to authenticated
using (public.can_manage_property(property_id))
with check (public.can_manage_property(property_id));

create or replace function public.create_property_with_rooms(
  target_company_id uuid,
  target_property_code text,
  target_area text,
  target_address text,
  target_room_count integer,
  target_is_commercial boolean default false,
  target_owner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  property_id uuid;
  unit_id uuid;
  normalized_code text := upper(nullif(trim(target_property_code), ''));
  normalized_area text := upper(nullif(trim(target_area), ''));
  normalized_address text := nullif(trim(target_address), '');
  room_index integer;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  if not (
    public.is_platform_admin()
    or exists (
      select 1
      from public.company_users as company_users
      where company_users.company_id = target_company_id
        and coalesce(company_users.user_id, company_users.profile_id) = actor_id
        and company_users.status::text = 'active'
        and company_users.role::text = 'admin_team'
    )
  ) then
    raise exception 'Admin access required';
  end if;

  if normalized_code is null
    or normalized_area is null
    or normalized_address is null
    or target_room_count < 1
    or target_room_count > 10000
  then
    raise exception 'Property code, area, address and a valid room count are required';
  end if;

  if exists (
    select 1
    from public.properties as properties
    where properties.company_id = target_company_id
      and lower(coalesce(properties.property_code, '')) = lower(normalized_code)
      and properties.status = 'active'
  ) then
    raise exception 'A property with this code already exists';
  end if;

  if target_owner_id is not null and not exists (
    select 1
    from public.company_users as company_users
    join public.profiles as profiles
      on profiles.id = coalesce(company_users.user_id, company_users.profile_id)
    where company_users.company_id = target_company_id
      and coalesce(company_users.user_id, company_users.profile_id) = target_owner_id
      and company_users.status::text = 'active'
      and company_users.role::text = 'owner'
      and profiles.role = 'owner'
  ) then
    raise exception 'Selected Owner is not active for this company';
  end if;

  insert into public.properties (
    company_id,
    name,
    property_code,
    area,
    address,
    status,
    is_commercial,
    created_by
  )
  values (
    target_company_id,
    normalized_code || ' - ' || normalized_area,
    normalized_code,
    normalized_area,
    normalized_address,
    'active',
    coalesce(target_is_commercial, false),
    actor_id
  )
  returning id into property_id;

  insert into public.units (
    company_id,
    property_id,
    name,
    notes,
    created_by
  )
  values (
    target_company_id,
    property_id,
    'Rooms',
    'Internal room grouping. Units are not shown in the DEKEZ interface.',
    actor_id
  )
  returning id into unit_id;

  for room_index in 1..target_room_count loop
    insert into public.rooms (
      company_id,
      property_id,
      unit_id,
      room_number,
      name,
      status,
      monthly_rent,
      created_by
    )
    values (
      target_company_id,
      property_id,
      unit_id,
      'Room ' || room_index,
      'Room ' || room_index,
      'vacant',
      0,
      actor_id
    );
  end loop;

  if target_owner_id is not null then
    insert into public.property_owners (
      property_id,
      owner_id,
      ownership_percentage,
      start_date,
      created_by
    )
    values (
      property_id,
      target_owner_id,
      100,
      current_date,
      actor_id
    );
  end if;

  return property_id;
end;
$$;

revoke all on function public.create_property_with_rooms(
  uuid,
  text,
  text,
  text,
  integer,
  boolean,
  uuid
) from public;

grant execute on function public.create_property_with_rooms(
  uuid,
  text,
  text,
  text,
  integer,
  boolean,
  uuid
) to authenticated;
