create unique index if not exists property_owners_one_active_owner_per_property
  on public.property_owners (property_id)
  where end_date is null;

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
      and property_owners.end_date is null
  );
$$;

create or replace function public.can_manage_property(target_property_id uuid)
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
      join public.company_users as company_users
        on company_users.company_id = properties.company_id
      where properties.id = target_property_id
        and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
        and company_users.status::text = 'active'
        and company_users.role::text = 'admin_team'
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
        and not exists (
          select 1
          from public.property_owners as property_owners
          where property_owners.property_id = properties.id
            and property_owners.end_date is null
        )
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
    or exists (
      select 1
      from public.tenancies as tenancies
      where tenancies.property_id = target_property_id
        and tenancies.tenant_id = auth.uid()
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

revoke all on function public.owns_property(uuid) from public;
revoke all on function public.can_manage_property(uuid) from public;
revoke all on function public.can_access_property(uuid) from public;
grant execute on function public.owns_property(uuid) to authenticated;
grant execute on function public.can_manage_property(uuid) to authenticated;
grant execute on function public.can_access_property(uuid) to authenticated;

drop policy if exists "company managers manage properties" on public.properties;
drop policy if exists "company members view properties" on public.properties;
drop policy if exists "properties_select_access" on public.properties;
drop policy if exists "properties_insert_manager" on public.properties;
drop policy if exists "properties_update_manager" on public.properties;
drop policy if exists "properties_portal_manage" on public.properties;
drop policy if exists "properties_portal_select" on public.properties;

create policy "properties_select_scope"
on public.properties
for select
to authenticated
using (public.can_access_property(id));

create policy "properties_insert_scope"
on public.properties
for insert
to authenticated
with check (
  public.is_platform_admin()
  or (
    public.can_manage_company(company_id)
    and created_by = auth.uid()
  )
);

create policy "properties_update_scope"
on public.properties
for update
to authenticated
using (public.can_manage_property(id))
with check (public.can_manage_property(id));

create policy "properties_delete_scope"
on public.properties
for delete
to authenticated
using (public.can_manage_property(id));

drop policy if exists "property_owners_manage_admin" on public.property_owners;
drop policy if exists "property_owners_select_allowed" on public.property_owners;

create policy "property_owners_select_scope"
on public.property_owners
for select
to authenticated
using (
  public.is_platform_admin()
  or owner_id = auth.uid()
  or public.can_manage_property(property_id)
);

create or replace function public.set_property_owner(
  target_property_id uuid,
  target_owner_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  property_company_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication required';
  end if;

  select properties.company_id
  into property_company_id
  from public.properties as properties
  where properties.id = target_property_id;

  if property_company_id is null then
    raise exception 'Property not found';
  end if;

  if not public.can_manage_property(target_property_id) then
    raise exception 'You are not allowed to assign this property';
  end if;

  if not exists (
    select 1
    from public.company_users as company_users
    join public.profiles as profiles
      on profiles.id = coalesce(company_users.user_id, company_users.profile_id)
    where company_users.company_id = property_company_id
      and coalesce(company_users.user_id, company_users.profile_id) = target_owner_id
      and company_users.status::text = 'active'
      and company_users.role::text = 'owner'
      and profiles.role = 'owner'
  ) then
    raise exception 'Selected Owner is not an active Owner for this company';
  end if;

  if exists (
    select 1
    from public.property_owners as property_owners
    where property_owners.property_id = target_property_id
      and property_owners.owner_id = target_owner_id
      and property_owners.end_date is null
  ) then
    return;
  end if;

  update public.property_owners
  set end_date = current_date,
      updated_at = now()
  where property_id = target_property_id
    and end_date is null;

  insert into public.property_owners (
    property_id,
    owner_id,
    ownership_percentage,
    start_date,
    end_date,
    created_by
  )
  values (
    target_property_id,
    target_owner_id,
    100,
    current_date,
    null,
    actor_id
  )
  on conflict (property_id, owner_id, start_date)
  do update set
    ownership_percentage = excluded.ownership_percentage,
    end_date = null,
    updated_at = now();
end;
$$;

revoke all on function public.set_property_owner(uuid, uuid) from public;
grant execute on function public.set_property_owner(uuid, uuid) to authenticated;
