alter table public.properties
  add column if not exists property_code text,
  add column if not exists area text,
  add column if not exists payment_qr_url text;

update public.properties
set property_code = nullif(trim(split_part(name, '-', 1)), ''),
    area = coalesce(
      area,
      nullif(location, ''),
      nullif(city, ''),
      nullif(trim(split_part(name, '-', 2)), '')
    )
where property_code is null or area is null;

create unique index if not exists properties_company_code_unique
  on public.properties (company_id, lower(property_code))
  where property_code is not null and property_code <> '';

alter table public.tenant_records
  add column if not exists tenant_id uuid references public.tenants(id) on delete set null,
  add column if not exists tenancy_id uuid references public.tenancies(id) on delete set null;

create index if not exists tenant_records_tenant_id_idx
  on public.tenant_records (tenant_id)
  where tenant_id is not null;

create index if not exists tenant_records_tenancy_id_idx
  on public.tenant_records (tenancy_id)
  where tenancy_id is not null;
