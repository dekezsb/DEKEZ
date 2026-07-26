drop policy if exists "tenancy_agreements_manage_admin"
  on public.tenancy_agreements;
drop policy if exists "tenancy_agreements_insert_admin"
  on public.tenancy_agreements;
drop policy if exists "tenancy_agreements_update_admin"
  on public.tenancy_agreements;
drop policy if exists "tenancy_agreements_delete_admin"
  on public.tenancy_agreements;

create policy "tenancy_agreements_insert_admin"
on public.tenancy_agreements
for insert
to authenticated
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.tenancies as tenancies
    where tenancies.id = tenancy_agreements.tenancy_id
      and public.can_manage_property(tenancies.property_id)
  )
);

create policy "tenancy_agreements_update_admin"
on public.tenancy_agreements
for update
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.tenancies as tenancies
    where tenancies.id = tenancy_agreements.tenancy_id
      and public.can_manage_property(tenancies.property_id)
  )
)
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.tenancies as tenancies
    where tenancies.id = tenancy_agreements.tenancy_id
      and public.can_manage_property(tenancies.property_id)
  )
);

create policy "tenancy_agreements_delete_admin"
on public.tenancy_agreements
for delete
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.tenancies as tenancies
    where tenancies.id = tenancy_agreements.tenancy_id
      and public.can_manage_property(tenancies.property_id)
  )
);
