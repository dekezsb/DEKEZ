create extension if not exists "pgcrypto";

create type public.app_role as enum (
  'super_admin',
  'owner',
  'admin_team',
  'technician_team',
  'tenant'
);

create type public.company_status as enum (
  'active',
  'inactive',
  'suspended'
);

create type public.company_user_status as enum (
  'active',
  'inactive',
  'invited'
);

create type public.room_status as enum (
  'vacant',
  'occupied',
  'maintenance',
  'reserved'
);

create type public.tenancy_status as enum (
  'draft',
  'active',
  'ended',
  'cancelled'
);

create type public.payment_status as enum (
  'pending',
  'paid',
  'partial',
  'overdue',
  'cancelled'
);

create type public.maintenance_status as enum (
  'open',
  'assigned',
  'in_progress',
  'resolved',
  'cancelled'
);

create type public.maintenance_priority as enum (
  'low',
  'medium',
  'high',
  'urgent'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  avatar_url text,
  global_role public.app_role not null default 'tenant',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  registration_number text,
  status public.company_status not null default 'active',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  status public.company_user_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, profile_id)
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  address text,
  city text,
  state text,
  postcode text,
  country text not null default 'Malaysia',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  name text not null,
  address text,
  city text,
  state text,
  postcode text,
  property_type text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  floor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete set null,
  full_name text not null,
  email text,
  phone text,
  identity_number text,
  emergency_contact_name text,
  emergency_contact_phone text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  room_number text not null,
  status public.room_status not null default 'vacant',
  current_tenancy_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (unit_id, room_number)
);

create table public.tenancies (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  monthly_rent numeric(12, 2) not null check (monthly_rent >= 0),
  deposit numeric(12, 2) not null default 0 check (deposit >= 0),
  start_date date not null,
  end_date date,
  due_day int not null check (due_day between 1 and 31),
  status public.tenancy_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenancies_end_after_start check (end_date is null or end_date >= start_date)
);

alter table public.rooms
  add constraint rooms_current_tenancy_id_fkey
  foreign key (current_tenancy_id)
  references public.tenancies(id)
  on delete set null;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete restrict,
  amount numeric(12, 2) not null check (amount >= 0),
  payment_method text,
  reference_number text,
  status public.payment_status not null default 'pending',
  payment_date date,
  notes text,
  collected_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  payment_id uuid not null references public.payments(id) on delete cascade,
  receipt_number text not null,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (company_id, receipt_number)
);

create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tenant_id uuid references public.tenants(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  title text not null,
  description text,
  status public.maintenance_status not null default 'open',
  priority public.maintenance_priority not null default 'medium',
  submitted_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.maintenance_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  maintenance_request_id uuid not null references public.maintenance_requests(id) on delete cascade,
  technician_profile_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  unique (maintenance_request_id, technician_profile_id)
);

create table public.maintenance_updates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  maintenance_request_id uuid not null references public.maintenance_requests(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  status public.maintenance_status,
  notes text,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  actor_profile_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_table text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index company_users_profile_id_idx on public.company_users(profile_id);
create index branches_company_id_idx on public.branches(company_id);
create index properties_company_id_idx on public.properties(company_id);
create index properties_branch_id_idx on public.properties(branch_id);
create index units_company_id_idx on public.units(company_id);
create index units_property_id_idx on public.units(property_id);
create index rooms_company_id_idx on public.rooms(company_id);
create index rooms_unit_id_idx on public.rooms(unit_id);
create index rooms_current_tenancy_id_idx on public.rooms(current_tenancy_id);
create index tenants_company_id_idx on public.tenants(company_id);
create index tenants_profile_id_idx on public.tenants(profile_id);
create index tenancies_company_id_idx on public.tenancies(company_id);
create index tenancies_tenant_id_idx on public.tenancies(tenant_id);
create index tenancies_room_id_idx on public.tenancies(room_id);
create unique index tenancies_one_active_per_room_idx
  on public.tenancies(room_id)
  where status = 'active';
create index payments_company_id_idx on public.payments(company_id);
create index payments_tenancy_id_idx on public.payments(tenancy_id);
create index maintenance_requests_company_id_idx on public.maintenance_requests(company_id);
create index maintenance_requests_tenant_id_idx on public.maintenance_requests(tenant_id);
create index maintenance_assignments_technician_idx on public.maintenance_assignments(technician_profile_id);
create index notifications_profile_id_idx on public.notifications(profile_id);
create index audit_logs_company_id_idx on public.audit_logs(company_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create trigger company_users_set_updated_at
before update on public.company_users
for each row execute function public.set_updated_at();

create trigger branches_set_updated_at
before update on public.branches
for each row execute function public.set_updated_at();

create trigger properties_set_updated_at
before update on public.properties
for each row execute function public.set_updated_at();

create trigger units_set_updated_at
before update on public.units
for each row execute function public.set_updated_at();

create trigger rooms_set_updated_at
before update on public.rooms
for each row execute function public.set_updated_at();

create trigger tenants_set_updated_at
before update on public.tenants
for each row execute function public.set_updated_at();

create trigger tenancies_set_updated_at
before update on public.tenancies
for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

create trigger maintenance_requests_set_updated_at
before update on public.maintenance_requests
for each row execute function public.set_updated_at();

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and global_role = 'super_admin'
  );
$$;

create or replace function public.has_company_role(
  target_company_id uuid,
  allowed_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.company_users
      where company_id = target_company_id
        and profile_id = auth.uid()
        and role = any(allowed_roles)
        and status = 'active'
    );
$$;

create or replace function public.is_assigned_technician(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.maintenance_assignments
    where maintenance_request_id = target_request_id
      and technician_profile_id = auth.uid()
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, global_role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    'tenant'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_users enable row level security;
alter table public.branches enable row level security;
alter table public.properties enable row level security;
alter table public.units enable row level security;
alter table public.rooms enable row level security;
alter table public.tenants enable row level security;
alter table public.tenancies enable row level security;
alter table public.payments enable row level security;
alter table public.receipts enable row level security;
alter table public.maintenance_requests enable row level security;
alter table public.maintenance_assignments enable row level security;
alter table public.maintenance_updates enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles can view self and company members"
on public.profiles for select
using (
  id = auth.uid()
  or public.is_super_admin()
  or exists (
    select 1
    from public.company_users viewer
    join public.company_users target
      on target.company_id = viewer.company_id
    where viewer.profile_id = auth.uid()
      and target.profile_id = profiles.id
      and viewer.status = 'active'
  )
);

create policy "profiles can update self"
on public.profiles for update
using (id = auth.uid() or public.is_super_admin())
with check (id = auth.uid() or public.is_super_admin());

create policy "super admins manage companies"
on public.companies for all
using (public.is_super_admin())
with check (public.is_super_admin());

create policy "company members view companies"
on public.companies for select
using (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_users
    where company_id = companies.id
      and profile_id = auth.uid()
      and status = 'active'
  )
);

create policy "company users visible within company"
on public.company_users for select
using (
  public.is_super_admin()
  or public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[])
  or profile_id = auth.uid()
);

create policy "owners manage company users"
on public.company_users for all
using (public.has_company_role(company_id, array['owner']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner']::public.app_role[]));

create policy "company managers manage branches"
on public.branches for all
using (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]));

create policy "company members view branches"
on public.branches for select
using (public.has_company_role(company_id, array['owner', 'admin_team', 'technician_team', 'tenant']::public.app_role[]));

create policy "company managers manage properties"
on public.properties for all
using (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]));

create policy "company members view properties"
on public.properties for select
using (public.has_company_role(company_id, array['owner', 'admin_team', 'technician_team', 'tenant']::public.app_role[]));

create policy "company managers manage units"
on public.units for all
using (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]));

create policy "company members view units"
on public.units for select
using (public.has_company_role(company_id, array['owner', 'admin_team', 'technician_team', 'tenant']::public.app_role[]));

create policy "company managers manage rooms"
on public.rooms for all
using (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]));

create policy "company members view rooms"
on public.rooms for select
using (public.has_company_role(company_id, array['owner', 'admin_team', 'technician_team', 'tenant']::public.app_role[]));

create policy "company managers manage tenants"
on public.tenants for all
using (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]));

create policy "tenants view own tenant record"
on public.tenants for select
using (
  public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[])
  or profile_id = auth.uid()
);

create policy "company managers manage tenancies"
on public.tenancies for all
using (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]));

create policy "tenants view own tenancies"
on public.tenancies for select
using (
  public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[])
  or exists (
    select 1
    from public.tenants
    where tenants.id = tenancies.tenant_id
      and tenants.profile_id = auth.uid()
  )
);

create policy "company finance users manage payments"
on public.payments for all
using (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]));

create policy "tenants view own payments"
on public.payments for select
using (
  exists (
    select 1
    from public.tenancies
    join public.tenants on tenants.id = tenancies.tenant_id
    where tenancies.id = payments.tenancy_id
      and tenants.profile_id = auth.uid()
  )
);

create policy "company finance users manage receipts"
on public.receipts for all
using (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]));

create policy "tenants view own receipts"
on public.receipts for select
using (
  exists (
    select 1
    from public.payments
    join public.tenancies on tenancies.id = payments.tenancy_id
    join public.tenants on tenants.id = tenancies.tenant_id
    where payments.id = receipts.payment_id
      and tenants.profile_id = auth.uid()
  )
);

create policy "company users manage maintenance requests"
on public.maintenance_requests for all
using (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]));

create policy "technicians view assigned requests"
on public.maintenance_requests for select
using (public.is_assigned_technician(id));

create policy "tenants view own maintenance requests"
on public.maintenance_requests for select
using (
  exists (
    select 1
    from public.tenants
    where tenants.id = maintenance_requests.tenant_id
      and tenants.profile_id = auth.uid()
  )
);

create policy "tenants create own maintenance requests"
on public.maintenance_requests for insert
with check (
  submitted_by = auth.uid()
  and exists (
    select 1
    from public.tenants
    where tenants.id = maintenance_requests.tenant_id
      and tenants.profile_id = auth.uid()
  )
);

create policy "company managers manage maintenance assignments"
on public.maintenance_assignments for all
using (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]))
with check (public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[]));

create policy "technicians view own assignments"
on public.maintenance_assignments for select
using (technician_profile_id = auth.uid());

create policy "maintenance updates visible to related users"
on public.maintenance_updates for select
using (
  public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[])
  or exists (
    select 1
    from public.maintenance_assignments
    where maintenance_request_id = maintenance_updates.maintenance_request_id
      and technician_profile_id = auth.uid()
  )
);

create policy "maintenance users create updates"
on public.maintenance_updates for insert
with check (
  public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[])
  or exists (
    select 1
    from public.maintenance_assignments
    where maintenance_request_id = maintenance_updates.maintenance_request_id
      and technician_profile_id = auth.uid()
  )
);

create policy "users view own notifications"
on public.notifications for select
using (profile_id = auth.uid());

create policy "company managers create notifications"
on public.notifications for insert
with check (
  company_id is null
  or public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[])
);

create policy "users update own notifications"
on public.notifications for update
using (profile_id = auth.uid())
with check (profile_id = auth.uid());

create policy "super admins view all audit logs"
on public.audit_logs for select
using (public.is_super_admin());

create policy "owners view company audit logs"
on public.audit_logs for select
using (public.has_company_role(company_id, array['owner']::public.app_role[]));

create policy "system can insert audit logs"
on public.audit_logs for insert
with check (
  public.is_super_admin()
  or company_id is null
  or public.has_company_role(company_id, array['owner', 'admin_team']::public.app_role[])
);
