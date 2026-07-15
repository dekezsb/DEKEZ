create table if not exists public.tenant_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  property_id uuid references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  identification_number text,
  monthly_rent numeric(12, 2) not null default 0,
  deposit numeric(12, 2) not null default 0,
  contract_start date,
  contract_end date,
  due_day integer,
  status text not null default 'active' check (status in ('active', 'inactive', 'moved_out')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, room_id, full_name)
);

alter table public.tenant_records enable row level security;

drop policy if exists "tenant_records_select_allowed" on public.tenant_records;
create policy "tenant_records_select_allowed" on public.tenant_records
for select using (
  public.is_platform_admin()
  or public.can_access_property(property_id)
);

drop policy if exists "tenant_records_manage_allowed" on public.tenant_records;
create policy "tenant_records_manage_allowed" on public.tenant_records
for all using (
  public.is_platform_admin()
  or public.can_access_property(property_id)
)
with check (
  public.is_platform_admin()
  or public.can_access_property(property_id)
);
