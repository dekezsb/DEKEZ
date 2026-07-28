drop trigger if exists protect_signed_tenancy_agreement_history
  on public.tenancy_agreements;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenancy_agreements'
      and column_name = 'agreement_type'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'tenancy_agreements'
      and column_name = 'term_type'
  ) then
    alter table public.tenancy_agreements
      rename column agreement_type to term_type;
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'tenancy_document_type'
  ) then
    create type public.tenancy_document_type as enum (
      'residential_room',
      'commercial_office'
    );
  end if;
end
$$;

alter table public.tenancy_agreements
  add column if not exists agreement_type public.tenancy_document_type;

update public.tenancy_agreements agreements
set agreement_type = case
  when coalesce(settings.property_type, '') in (
    'office',
    'shop_lot'
  ) or coalesce(properties.is_commercial, false)
    then 'commercial_office'::public.tenancy_document_type
  else 'residential_room'::public.tenancy_document_type
end
from public.tenancies tenancies
join public.properties properties
  on properties.id = tenancies.property_id
left join public.property_tenancy_settings settings
  on settings.property_id = properties.id
where agreements.tenancy_id = tenancies.id
  and agreements.agreement_type is null;

update public.tenancy_agreements
set agreement_type = 'residential_room'::public.tenancy_document_type
where agreement_type is null;

alter table public.tenancy_agreements
  alter column agreement_type
    set default 'residential_room'::public.tenancy_document_type,
  alter column agreement_type set not null;

alter table public.property_tenancy_settings
  add column if not exists default_agreement_type
    public.tenancy_document_type not null
    default 'residential_room'::public.tenancy_document_type,
  add column if not exists water_monthly_quota numeric(12, 2),
  add column if not exists water_rate numeric(12, 4),
  add column if not exists electricity_monthly_quota numeric(12, 2),
  add column if not exists electricity_rate numeric(12, 4),
  add column if not exists employee_limit integer;

update public.property_tenancy_settings settings
set default_agreement_type = case
  when settings.property_type in ('office', 'shop_lot')
    or coalesce(properties.is_commercial, false)
    then 'commercial_office'::public.tenancy_document_type
  else 'residential_room'::public.tenancy_document_type
end
from public.properties properties
where properties.id = settings.property_id;

alter table public.property_tenancy_settings
  drop constraint if exists property_tenancy_settings_water_mode_check,
  drop constraint if exists property_tenancy_settings_electricity_mode_check,
  drop constraint if exists property_tenancy_settings_water_monthly_quota_check,
  drop constraint if exists property_tenancy_settings_water_rate_check,
  drop constraint if exists property_tenancy_settings_electricity_monthly_quota_check,
  drop constraint if exists property_tenancy_settings_electricity_rate_check,
  drop constraint if exists property_tenancy_settings_employee_limit_check;

alter table public.property_tenancy_settings
  add constraint property_tenancy_settings_water_mode_check
    check (water_mode in ('included', 'tenant_pays', 'smart_meter', 'monthly_quota')),
  add constraint property_tenancy_settings_electricity_mode_check
    check (electricity_mode in ('included', 'tenant_pays', 'smart_meter', 'monthly_quota')),
  add constraint property_tenancy_settings_water_monthly_quota_check
    check (water_monthly_quota is null or water_monthly_quota >= 0),
  add constraint property_tenancy_settings_water_rate_check
    check (water_rate is null or water_rate >= 0),
  add constraint property_tenancy_settings_electricity_monthly_quota_check
    check (electricity_monthly_quota is null or electricity_monthly_quota >= 0),
  add constraint property_tenancy_settings_electricity_rate_check
    check (electricity_rate is null or electricity_rate >= 0),
  add constraint property_tenancy_settings_employee_limit_check
    check (employee_limit is null or employee_limit > 0);

alter table public.tenants
  add column if not exists tenant_type text not null default 'individual',
  add column if not exists business_name text,
  add column if not exists business_registration_number text,
  add column if not exists registered_address text,
  add column if not exists authorised_representative_name text,
  add column if not exists representative_identity_number text,
  add column if not exists business_contact_number text,
  add column if not exists business_email text;

alter table public.tenants
  drop constraint if exists tenants_tenant_type_check;

alter table public.tenants
  add constraint tenants_tenant_type_check
    check (tenant_type in ('individual', 'company', 'sole_proprietor'));

alter table public.tenant_applications
  add column if not exists agreement_type public.tenancy_document_type,
  add column if not exists tenant_type text not null default 'individual',
  add column if not exists business_name text,
  add column if not exists business_registration_number text,
  add column if not exists registered_address text,
  add column if not exists authorised_representative_name text,
  add column if not exists representative_identity_number text,
  add column if not exists business_contact_number text,
  add column if not exists business_email text;

alter table public.tenant_applications
  drop constraint if exists tenant_applications_tenant_type_check;

alter table public.tenant_applications
  add constraint tenant_applications_tenant_type_check
    check (tenant_type in ('individual', 'company', 'sole_proprietor'));

create or replace function public.protect_signed_tenancy_agreement_history()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.signed_at is not null
      or old.status::text in ('signed', 'renewal_signed')
    then
      raise exception 'Signed tenancy agreements are permanent and cannot be deleted';
    end if;

    return old;
  end if;

  if old.signed_at is not null
    or old.status::text in ('signed', 'renewal_signed')
  then
    if new.tenancy_id is distinct from old.tenancy_id
      or new.term_type is distinct from old.term_type
      or new.agreement_type is distinct from old.agreement_type
      or new.version_number is distinct from old.version_number
      or new.rendered_content is distinct from old.rendered_content
      or new.monthly_rent_snapshot is distinct from old.monthly_rent_snapshot
      or new.generated_at is distinct from old.generated_at
      or new.signed_at is distinct from old.signed_at
      or new.pdf_url is distinct from old.pdf_url
      or new.term_start_date is distinct from old.term_start_date
      or new.term_end_date is distinct from old.term_end_date
      or new.tenant_name_snapshot is distinct from old.tenant_name_snapshot
      or new.property_name_snapshot is distinct from old.property_name_snapshot
      or new.room_name_snapshot is distinct from old.room_name_snapshot
    then
      raise exception 'Signed tenancy agreement content and files are immutable';
    end if;
  end if;

  return new;
end;
$$;

create trigger protect_signed_tenancy_agreement_history
before update or delete on public.tenancy_agreements
for each row
execute function public.protect_signed_tenancy_agreement_history();
