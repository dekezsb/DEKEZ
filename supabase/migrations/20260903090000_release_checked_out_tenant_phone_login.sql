create or replace function public.release_checked_out_tenant_phone_login(
  p_tenancy_id uuid,
  p_tenant_id uuid,
  p_profile_id uuid,
  p_released_at timestamptz default now()
)
returns text
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  tenant_ids uuid[];
begin
  if not exists (
    select 1
    from public.tenancies as tenancy
    where tenancy.id = p_tenancy_id
      and tenancy.tenant_id = p_tenant_id
      and tenancy.status <> 'active'
      and tenancy.checkout_date is not null
  ) then
    return 'tenancy_not_checked_out';
  end if;

  if exists (
    select 1
    from public.tenancies as tenancy
    join public.tenants as tenant on tenant.id = tenancy.tenant_id
    where tenancy.status = 'active'
      and tenancy.checkout_date is null
      and (
        tenant.id = p_tenant_id
        or tenant.profile_id = p_profile_id
      )
  ) then
    return 'active_tenancy';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_profile_id
      and profile.role = 'tenant'
  ) then
    return 'profile_not_tenant';
  end if;

  select coalesce(array_agg(tenant.id), array[p_tenant_id])
  into tenant_ids
  from public.tenants as tenant
  where tenant.id = p_tenant_id
    or tenant.profile_id = p_profile_id;

  update public.tenant_records
  set
    phone = null,
    updated_at = p_released_at
  where tenancy_id = p_tenancy_id
    or tenant_id = any(tenant_ids);

  update public.tenants
  set
    phone = null,
    profile_id = null,
    status = 'inactive',
    updated_at = p_released_at
  where id = any(tenant_ids);

  update public.profiles
  set
    phone = null,
    normalized_phone = null,
    updated_at = p_released_at
  where id = p_profile_id;

  return 'released';
end;
$$;

revoke all on function public.release_checked_out_tenant_phone_login(
  uuid,
  uuid,
  uuid,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.release_checked_out_tenant_phone_login(
  uuid,
  uuid,
  uuid,
  timestamptz
) to service_role;

comment on function public.release_checked_out_tenant_phone_login(
  uuid,
  uuid,
  uuid,
  timestamptz
) is
  'Releases a checked-out tenant phone and profile link for re-registration while preserving tenancy, invoice, payment, agreement and audit history.';
