alter table public.tenancies
  add column security_deposit_override numeric(12,2),
  add column utility_deposit_override numeric(12,2),
  add constraint agreed_deposit_override_pair check (
    (security_deposit_override is null and utility_deposit_override is null) or
    (security_deposit_override is not null and utility_deposit_override is not null
      and security_deposit_override >= 0 and utility_deposit_override >= 0)
  );

create function public.preserve_agreed_tenancy_deposit()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if new.security_deposit_override is not null and new.utility_deposit_override is not null then
    if new.rental_model = 'monthly_stay' then
      raise exception 'Monthly stay does not support a commercial deposit override.';
    end if;
    new.deposit := new.security_deposit_override + new.utility_deposit_override;
  end if;
  return new;
end;
$$;
create trigger preserve_agreed_tenancy_deposit before insert or update of deposit, security_deposit_override, utility_deposit_override
on public.tenancies for each row execute function public.preserve_agreed_tenancy_deposit();

create function public.preserve_agreed_tenant_record_deposit()
returns trigger language plpgsql set search_path to 'public' as $$
declare agreed_amount numeric;
begin
  select security_deposit_override + utility_deposit_override into agreed_amount
  from public.tenancies where id = new.tenancy_id;
  if agreed_amount is not null then new.deposit := agreed_amount; end if;
  return new;
end;
$$;
create trigger preserve_agreed_tenant_record_deposit before insert or update of deposit, tenancy_id
on public.tenant_records for each row execute function public.preserve_agreed_tenant_record_deposit();
