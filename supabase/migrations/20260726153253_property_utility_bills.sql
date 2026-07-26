-- Property-level utility billing and separate tenant smart-meter records.
alter table public.utility_bills
  add column if not exists billing_scope text,
  add column if not exists account_number text,
  add column if not exists reference_number text,
  add column if not exists due_date date,
  add column if not exists payment_date date,
  add column if not exists bill_attachment_path text,
  add column if not exists bill_attachment_name text,
  add column if not exists bill_attachment_type text,
  add column if not exists receipt_path text,
  add column if not exists receipt_name text,
  add column if not exists receipt_type text,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null;

update public.utility_bills
set billing_scope = case
  when room_id is null then 'property'
  else 'tenant_usage_legacy'
end
where billing_scope is null;

alter table public.utility_bills
  alter column billing_scope set default 'property',
  alter column billing_scope set not null;

alter table public.utility_bills
  drop constraint if exists utility_bills_billing_scope_check,
  add constraint utility_bills_billing_scope_check
    check (billing_scope in ('property', 'tenant_usage_legacy')),
  drop constraint if exists utility_bills_utility_type_check,
  add constraint utility_bills_utility_type_check
    check (utility_type in ('water', 'electricity', 'sewerage', 'internet', 'other'));

create unique index if not exists utility_bills_property_type_month_unique
  on public.utility_bills (property_id, utility_type, bill_month)
  where billing_scope = 'property';

create index if not exists utility_bills_property_month_idx
  on public.utility_bills (property_id, bill_month desc)
  where billing_scope = 'property';

create table if not exists public.smart_meters (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  meter_number text not null,
  meter_type text not null check (meter_type in ('water', 'electricity')),
  rate numeric(12, 4) not null default 0 check (rate >= 0),
  remaining_credit numeric(12, 2) not null default 0,
  status text not null default 'active' check (status in ('active', 'inactive', 'replaced')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, meter_number)
);

create table if not exists public.smart_meter_readings (
  id uuid primary key default gen_random_uuid(),
  meter_id uuid not null references public.smart_meters(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  billing_month date not null,
  previous_reading numeric(14, 3) not null default 0,
  current_reading numeric(14, 3) not null default 0,
  usage numeric(14, 3) generated always as (
    greatest(current_reading - previous_reading, 0)
  ) stored,
  rate numeric(12, 4) not null default 0,
  charge_amount numeric(12, 2) not null default 0,
  top_up_amount numeric(12, 2) not null default 0,
  remaining_credit numeric(12, 2) not null default 0,
  reading_date date not null default current_date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meter_id, billing_month),
  check (current_reading >= previous_reading),
  check (rate >= 0),
  check (charge_amount >= 0),
  check (top_up_amount >= 0)
);

create index if not exists smart_meters_room_idx
  on public.smart_meters (room_id, status);

create index if not exists smart_meter_readings_room_month_idx
  on public.smart_meter_readings (room_id, billing_month desc);

create or replace function public.can_manage_property_expenses(target_property_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.current_profile_role() = 'super_admin'
    or public.owns_property(target_property_id)
    or exists (
      select 1
      from public.properties as properties
      join public.company_users as company_users
        on company_users.company_id = properties.company_id
      where properties.id = target_property_id
        and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
        and company_users.status::text = 'active'
        and company_users.role::text in ('admin', 'admin_team')
    );
$$;

revoke all on function public.can_manage_property_expenses(uuid) from public;
grant execute on function public.can_manage_property_expenses(uuid) to authenticated;

alter table public.smart_meters enable row level security;
alter table public.smart_meter_readings enable row level security;

drop policy if exists "utility_bills_select_allowed" on public.utility_bills;
drop policy if exists "utility_bills_manage_admin_member" on public.utility_bills;
drop policy if exists "utility_bills_select_property_access" on public.utility_bills;
drop policy if exists "utility_bills_insert_property_access" on public.utility_bills;
drop policy if exists "utility_bills_update_property_access" on public.utility_bills;

create policy "utility_bills_select_property_access" on public.utility_bills
for select
to authenticated
using (
  billing_scope = 'property'
  and public.can_manage_property_expenses(property_id)
);

create policy "utility_bills_insert_property_access" on public.utility_bills
for insert
to authenticated
with check (
  billing_scope = 'property'
  and tenant_id is null
  and unit_id is null
  and room_id is null
  and public.can_manage_property_expenses(property_id)
);

create policy "utility_bills_update_property_access" on public.utility_bills
for update
to authenticated
using (
  billing_scope = 'property'
  and public.can_manage_property_expenses(property_id)
)
with check (
  billing_scope = 'property'
  and tenant_id is null
  and unit_id is null
  and room_id is null
  and public.can_manage_property_expenses(property_id)
);

drop policy if exists "smart_meters_select_allowed" on public.smart_meters;
drop policy if exists "smart_meters_manage_property_access" on public.smart_meters;

create policy "smart_meters_select_allowed" on public.smart_meters
for select
to authenticated
using (
  public.can_manage_property_expenses(property_id)
  or exists (
    select 1
    from public.tenants as tenants
    where tenants.id = smart_meters.tenant_id
      and tenants.profile_id = auth.uid()
  )
);

create policy "smart_meters_manage_property_access" on public.smart_meters
for all
to authenticated
using (public.can_manage_property_expenses(property_id))
with check (public.can_manage_property_expenses(property_id));

drop policy if exists "smart_meter_readings_select_allowed" on public.smart_meter_readings;
drop policy if exists "smart_meter_readings_manage_property_access" on public.smart_meter_readings;

create policy "smart_meter_readings_select_allowed" on public.smart_meter_readings
for select
to authenticated
using (
  exists (
    select 1
    from public.smart_meters as meters
    where meters.id = smart_meter_readings.meter_id
      and (
        public.can_manage_property_expenses(meters.property_id)
        or exists (
          select 1
          from public.tenants as tenants
          where tenants.id = meters.tenant_id
            and tenants.profile_id = auth.uid()
        )
      )
  )
);

create policy "smart_meter_readings_manage_property_access" on public.smart_meter_readings
for all
to authenticated
using (
  exists (
    select 1
    from public.smart_meters as meters
    where meters.id = smart_meter_readings.meter_id
      and public.can_manage_property_expenses(meters.property_id)
  )
)
with check (
  exists (
    select 1
    from public.smart_meters as meters
    where meters.id = smart_meter_readings.meter_id
      and public.can_manage_property_expenses(meters.property_id)
  )
);

grant select, insert, update on public.utility_bills to authenticated;
grant select, insert, update, delete on public.smart_meters to authenticated;
grant select, insert, update, delete on public.smart_meter_readings to authenticated;

insert into storage.buckets (id, name, public)
values ('utility-bill-documents', 'utility-bill-documents', false)
on conflict (id) do nothing;

drop policy if exists "utility_bill_documents_insert_allowed" on storage.objects;
drop policy if exists "utility_bill_documents_select_allowed" on storage.objects;
drop policy if exists "utility_bill_documents_update_allowed" on storage.objects;
drop policy if exists "utility_bill_documents_delete_allowed" on storage.objects;

create policy "utility_bill_documents_insert_allowed" on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'utility-bill-documents'
  and exists (
    select 1
    from public.properties as properties
    where properties.id::text = (storage.foldername(name))[1]
      and public.can_manage_property_expenses(properties.id)
  )
);

create policy "utility_bill_documents_select_allowed" on storage.objects
for select
to authenticated
using (
  bucket_id = 'utility-bill-documents'
  and exists (
    select 1
    from public.utility_bills as bills
    where (
      bills.bill_attachment_path = storage.objects.name
      or bills.receipt_path = storage.objects.name
    )
      and public.can_manage_property_expenses(bills.property_id)
  )
);

create policy "utility_bill_documents_update_allowed" on storage.objects
for update
to authenticated
using (
  bucket_id = 'utility-bill-documents'
  and exists (
    select 1
    from public.properties as properties
    where properties.id::text = (storage.foldername(name))[1]
      and public.can_manage_property_expenses(properties.id)
  )
)
with check (
  bucket_id = 'utility-bill-documents'
  and exists (
    select 1
    from public.properties as properties
    where properties.id::text = (storage.foldername(name))[1]
      and public.can_manage_property_expenses(properties.id)
  )
);

create policy "utility_bill_documents_delete_allowed" on storage.objects
for delete
to authenticated
using (
  bucket_id = 'utility-bill-documents'
  and exists (
    select 1
    from public.properties as properties
    where properties.id::text = (storage.foldername(name))[1]
      and public.can_manage_property_expenses(properties.id)
  )
);
