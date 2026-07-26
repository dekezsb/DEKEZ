create or replace function public.current_profile_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    (
      select profiles.role::text
      from public.profiles as profiles
      where profiles.id = auth.uid()
    ),
    'tenant'
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_role() in ('super_admin', 'admin');
$$;

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_users as company_users
    where company_users.company_id = target_company_id
      and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
      and company_users.status::text = 'active'
  );
$$;

create or replace function public.can_manage_company(target_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.company_users as company_users
      where company_users.company_id = target_company_id
        and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
        and company_users.status::text = 'active'
        and company_users.role::text in ('owner', 'admin', 'admin_team')
    );
$$;

create or replace function public.owns_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.property_owners as property_owners
    where property_owners.property_id = target_property_id
      and property_owners.owner_id = auth.uid()
      and (
        property_owners.end_date is null
        or property_owners.end_date >= current_date
      )
  )
  or exists (
    select 1
    from public.properties as properties
    join public.company_users as company_users
      on company_users.company_id = properties.company_id
    where properties.id = target_property_id
      and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
      and company_users.status::text = 'active'
      and company_users.role::text = 'owner'
  );
$$;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members as organization_members
    where organization_members.organization_id = target_organization_id
      and organization_members.user_id = auth.uid()
      and organization_members.status::text = 'active'
  );
$$;

create or replace function public.can_access_property(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or public.owns_property(target_property_id)
    or exists (
      select 1
      from public.properties as properties
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
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.maintenance_ticket_assignments as assignments
    where assignments.ticket_id = target_ticket_id
      and assignments.assigned_to = auth.uid()
      and assignments.status::text <> 'cancelled'
  );
$$;

create or replace function public.can_access_ticket(target_ticket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.maintenance_tickets as tickets
      where tickets.id = target_ticket_id
        and (
          tickets.tenant_id = auth.uid()
          or public.owns_property(tickets.property_id)
          or public.is_assigned_to_ticket(tickets.id)
        )
    );
$$;
