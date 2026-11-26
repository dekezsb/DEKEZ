-- Checkout record + tenant login revoke (JV rule, 24 Nov 2026).
-- Additive only: no data is changed or backfilled.

-- 1. Keep the real checkout moment and the original contract end. Checkout
--    still writes checkout_date and closes the end columns as before; the
--    contract end that applied just before checkout is preserved here so an
--    early checkout stays visible.
alter table public.tenancies
  add column if not exists checked_out_at timestamptz,
  add column if not exists contract_end_before_checkout date;

comment on column public.tenancies.checked_out_at is
  'When staff completed the checkout (checkout_date is the business date).';
comment on column public.tenancies.contract_end_before_checkout is
  'Contract end date as it stood immediately before checkout; checkout_date earlier than this is an early checkout.';

-- 2. Sign out every session of a tenant whose login was disabled at checkout.
--    Tenant profiles only; staff, admin and owner accounts are never touched.
create or replace function public.revoke_tenant_auth_sessions(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer := 0;
begin
  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_user_id
      and profile.role::text = 'tenant'
  ) then
    return 0;
  end if;

  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.revoke_tenant_auth_sessions(uuid)
  from public, anon, authenticated;
grant execute on function public.revoke_tenant_auth_sessions(uuid)
  to service_role;

comment on function public.revoke_tenant_auth_sessions(uuid) is
  'Signs out all sessions of a checked-out tenant. Tenant profiles only.';
