update public.tenant_referral_codes code
set referral_code = trim(tenant.phone)
from public.tenants tenant
where tenant.id = code.tenant_id
  and nullif(trim(tenant.phone), '') is not null;

create or replace function private.create_tenant_referral_code()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.profile_id is not null then
    insert into public.tenant_referral_codes (company_id, tenant_id, referral_code)
    values (
      new.company_id,
      new.id,
      coalesce(
        nullif(trim(new.phone), ''),
        'DEKEZ-' || upper(substr(replace(new.id::text, '-', ''), 1, 8))
      )
    )
    on conflict (tenant_id) do update
    set company_id = excluded.company_id,
        referral_code = excluded.referral_code;
  end if;
  return new;
end;
$$;

drop trigger if exists tenant_referral_code_after_insert on public.tenants;
create trigger tenant_referral_code_after_insert
after insert or update of profile_id, phone on public.tenants
for each row execute function private.create_tenant_referral_code();
