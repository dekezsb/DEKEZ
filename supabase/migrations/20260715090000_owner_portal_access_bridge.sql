create extension if not exists "pgcrypto";

do $$
begin
  if exists (select 1 from pg_type where typname = 'app_role') then
    alter type public.app_role add value if not exists 'super_admin';
    alter type public.app_role add value if not exists 'owner';
    alter type public.app_role add value if not exists 'admin';
    alter type public.app_role add value if not exists 'technician';
    alter type public.app_role add value if not exists 'maintenance_staff';
    alter type public.app_role add value if not exists 'cleaning_staff';
    alter type public.app_role add value if not exists 'tenant';
  end if;
end $$;

alter table if exists public.company_users
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists profile_id uuid references public.profiles(id) on delete cascade,
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists role public.app_role not null default 'owner',
  add column if not exists status public.company_user_status not null default 'active',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.properties
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists address text,
  add column if not exists notes text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.units
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists name text,
  add column if not exists floor text,
  add column if not exists notes text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.rooms
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists name text,
  add column if not exists room_number text,
  add column if not exists status public.room_status not null default 'vacant',
  add column if not exists monthly_rent numeric(12, 2) not null default 0,
  add column if not exists description text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

update public.company_users
set user_id = profile_id
where user_id is null
  and profile_id is not null;

update public.company_users
set profile_id = user_id
where profile_id is null
  and user_id is not null;

update public.rooms
set name = room_number
where name is null
  and room_number is not null;

update public.rooms
set room_number = name
where room_number is null
  and name is not null;

insert into public.property_owners (
  property_id,
  owner_id,
  ownership_percentage,
  start_date,
  created_by
)
select
  properties.id,
  coalesce(company_users.user_id, company_users.profile_id),
  100,
  current_date,
  coalesce(company_users.created_by, company_users.user_id, company_users.profile_id)
from public.properties properties
join public.company_users company_users
  on company_users.company_id = properties.company_id
where company_users.role::text = 'owner'
  and company_users.status = 'active'
  and coalesce(company_users.user_id, company_users.profile_id) is not null
  and not exists (
    select 1
    from public.property_owners property_owners
    where property_owners.property_id = properties.id
      and property_owners.owner_id = coalesce(company_users.user_id, company_users.profile_id)
      and property_owners.end_date is null
  );

create or replace function public.current_profile_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'role', ''),
    (select profiles.role from public.profiles profiles where profiles.id = auth.uid()),
    'tenant'
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
as $$
  select public.current_profile_role() in ('super_admin', 'admin');
$$;

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.company_users company_users
    where company_users.company_id = target_company_id
      and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
      and company_users.status = 'active'
  );
$$;

create or replace function public.can_manage_company(target_company_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.company_users company_users
      where company_users.company_id = target_company_id
        and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
        and company_users.status = 'active'
        and company_users.role::text in ('owner', 'admin')
    );
$$;

create or replace function public.owns_property(target_property_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.property_owners property_owners
    where property_owners.property_id = target_property_id
      and property_owners.owner_id = auth.uid()
      and (property_owners.end_date is null or property_owners.end_date >= current_date)
  )
  or exists (
    select 1
    from public.properties properties
    join public.company_users company_users
      on company_users.company_id = properties.company_id
    where properties.id = target_property_id
      and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
      and company_users.status = 'active'
      and company_users.role::text = 'owner'
  );
$$;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.organization_members organization_members
    where organization_members.organization_id = target_organization_id
      and organization_members.user_id = auth.uid()
      and organization_members.status = 'active'
  );
$$;

create or replace function public.can_access_property(target_property_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_platform_admin()
    or public.owns_property(target_property_id)
    or exists (
      select 1
      from public.properties properties
      where properties.id = target_property_id
        and (
          (
            properties.organization_id is not null
            and public.is_organization_member(properties.organization_id)
          )
          or (
            properties.company_id is not null
            and public.is_company_member(properties.company_id)
          )
        )
    );
$$;

create or replace function public.is_assigned_to_ticket(target_ticket_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.maintenance_ticket_assignments assignments
    where assignments.ticket_id = target_ticket_id
      and assignments.assigned_to = auth.uid()
      and assignments.status <> 'cancelled'
  );
$$;

create or replace function public.can_access_ticket(target_ticket_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.maintenance_tickets tickets
      where tickets.id = target_ticket_id
        and (
          tickets.tenant_id = auth.uid()
          or public.owns_property(tickets.property_id)
          or public.is_assigned_to_ticket(tickets.id)
        )
    );
$$;

drop policy if exists "properties_portal_select" on public.properties;
create policy "properties_portal_select" on public.properties
for select using (public.can_access_property(id));

drop policy if exists "properties_portal_manage" on public.properties;
create policy "properties_portal_manage" on public.properties
for all using (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
  or (
    company_id is not null
    and public.can_manage_company(company_id)
  )
)
with check (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
  or (
    company_id is not null
    and public.can_manage_company(company_id)
  )
);

drop policy if exists "units_select_allowed" on public.units;
create policy "units_select_allowed" on public.units
for select using (public.can_access_property(property_id));

drop policy if exists "units_manage_admin_member" on public.units;
create policy "units_manage_admin_member" on public.units
for all using (
  public.is_platform_admin()
  or public.can_access_property(property_id)
)
with check (
  public.is_platform_admin()
  or public.can_access_property(property_id)
);

drop policy if exists "rooms_portal_select" on public.rooms;
create policy "rooms_portal_select" on public.rooms
for select using (
  public.can_access_property(property_id)
  or exists (
    select 1
    from public.tenancies tenancies
    where tenancies.room_id = rooms.id
      and tenancies.tenant_id = auth.uid()
      and tenancies.status = 'active'
  )
);

drop policy if exists "rooms_portal_manage" on public.rooms;
create policy "rooms_portal_manage" on public.rooms
for all using (
  public.is_platform_admin()
  or public.can_access_property(property_id)
)
with check (
  public.is_platform_admin()
  or public.can_access_property(property_id)
);
