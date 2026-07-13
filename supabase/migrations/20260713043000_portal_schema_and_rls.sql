create extension if not exists "pgcrypto";

do $$
begin
  if exists (select 1 from pg_type where typname = 'app_role') then
    alter type public.app_role add value if not exists 'maintenance_staff';
    alter type public.app_role add value if not exists 'cleaning_staff';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_urgency') then
    create type public.ticket_urgency as enum ('low', 'normal', 'urgent');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_status') then
    create type public.ticket_status as enum (
      'submitted',
      'assigned',
      'in_progress',
      'waiting_for_parts',
      'completed',
      'rejected',
      'closed'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'ticket_type') then
    create type public.ticket_type as enum ('maintenance', 'repair', 'cleaning');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'claim_status') then
    create type public.claim_status as enum (
      'draft',
      'pending_owner_approval',
      'information_requested',
      'approved',
      'rejected',
      'paid'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'bill_status') then
    create type public.bill_status as enum ('draft', 'unpaid', 'partial', 'paid', 'cancelled');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'payment_status') then
    create type public.payment_status as enum ('pending', 'confirmed', 'cancelled', 'refunded');
  end if;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'tenant' check (
    role in (
      'super_admin',
      'owner',
      'admin',
      'technician',
      'maintenance_staff',
      'cleaning_staff',
      'tenant'
    )
  ),
  organization_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists full_name text,
  add column if not exists phone text,
  add column if not exists role text not null default 'tenant',
  add column if not exists organization_id uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  status text not null default 'active' check (status in ('active', 'inactive', 'suspended')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_organization_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_organization_id_fkey
      foreign key (organization_id)
      references public.organizations(id)
      on delete set null;
  end if;
end $$;

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (
    role in (
      'owner',
      'admin',
      'technician',
      'maintenance_staff',
      'cleaning_staff',
      'tenant'
    )
  ),
  status text not null default 'active' check (status in ('active', 'inactive', 'invited')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

alter table public.properties
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists location text,
  add column if not exists status text not null default 'active' check (status in ('active', 'inactive'));

create table if not exists public.property_owners (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  ownership_percentage numeric(5, 2) not null default 100 check (
    ownership_percentage > 0 and ownership_percentage <= 100
  ),
  start_date date not null default current_date,
  end_date date,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, owner_id, start_date)
);

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  floor text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, name)
);

alter table public.rooms
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists description text;

create table if not exists public.tenancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  monthly_rental numeric(12, 2) not null default 0,
  deposit numeric(12, 2) not null default 0,
  contract_start date not null,
  contract_end date,
  due_day integer not null default 1 check (due_day between 1 and 31),
  status text not null default 'active' check (status in ('active', 'ended', 'cancelled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rent_bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  room_id uuid not null references public.rooms(id) on delete cascade,
  bill_month date not null,
  due_date date not null,
  amount numeric(12, 2) not null default 0,
  paid_amount numeric(12, 2) not null default 0,
  status public.bill_status not null default 'unpaid',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenancy_id, bill_month)
);

create table if not exists public.utility_bills (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  tenant_id uuid references auth.users(id) on delete set null,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  utility_type text not null check (utility_type in ('water', 'electricity', 'internet', 'other')),
  bill_month date not null,
  amount numeric(12, 2) not null default 0,
  paid_amount numeric(12, 2) not null default 0,
  status public.bill_status not null default 'unpaid',
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  tenant_id uuid references auth.users(id) on delete set null,
  tenancy_id uuid references public.tenancies(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  unit_id uuid references public.units(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  category text not null,
  amount numeric(12, 2) not null check (amount >= 0),
  payment_date date not null default current_date,
  payment_method text not null default 'cash',
  reference_number text,
  notes text,
  status public.payment_status not null default 'confirmed',
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  transaction_type text not null check (transaction_type in ('top_up', 'deduction', 'refund', 'adjustment')),
  amount numeric(12, 2) not null,
  reference_number text,
  notes text,
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number text not null unique default ('DKZ-' || upper(substr(gen_random_uuid()::text, 1, 8))),
  organization_id uuid references public.organizations(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  unit_id uuid references public.units(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  ticket_type public.ticket_type not null default 'maintenance',
  category text,
  description text not null,
  urgency public.ticket_urgency not null default 'normal',
  status public.ticket_status not null default 'submitted',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.maintenance_ticket_assignments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.maintenance_tickets(id) on delete cascade,
  assigned_to uuid not null references auth.users(id) on delete cascade,
  assigned_by uuid references auth.users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  required_completion_date date,
  status text not null default 'assigned' check (status in ('assigned', 'accepted', 'completed', 'cancelled')),
  unique (ticket_id, assigned_to)
);

create table if not exists public.maintenance_updates (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.maintenance_tickets(id) on delete cascade,
  updated_by uuid not null references auth.users(id) on delete cascade,
  status public.ticket_status,
  notes text,
  labour_cost numeric(12, 2) not null default 0,
  material_cost numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.maintenance_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.maintenance_tickets(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  attachment_type text not null default 'problem' check (
    attachment_type in ('problem', 'before', 'after', 'receipt', 'invoice', 'other')
  ),
  bucket_name text not null default 'maintenance-attachments',
  file_path text not null,
  content_type text,
  created_at timestamptz not null default now()
);

create table if not exists public.claims (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.maintenance_tickets(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  submitted_by uuid not null references auth.users(id) on delete cascade,
  labour_cost numeric(12, 2) not null default 0,
  material_cost numeric(12, 2) not null default 0,
  total_amount numeric(12, 2) generated always as (labour_cost + material_cost) stored,
  description text,
  status public.claim_status not null default 'pending_owner_approval',
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.claim_attachments (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  bucket_name text not null default 'claim-attachments',
  file_path text not null,
  content_type text,
  created_at timestamptz not null default now()
);

alter table public.organization_members
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists role text not null default 'tenant',
  add column if not exists status text not null default 'active',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.properties
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists location text,
  add column if not exists status text not null default 'active';

alter table public.property_owners
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists ownership_percentage numeric(5, 2) not null default 100,
  add column if not exists start_date date not null default current_date,
  add column if not exists end_date date,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.units
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists name text,
  add column if not exists floor text,
  add column if not exists notes text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.rooms
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists description text;

alter table public.tenancies
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists tenant_id uuid references auth.users(id) on delete cascade,
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists room_id uuid references public.rooms(id) on delete cascade,
  add column if not exists monthly_rental numeric(12, 2) not null default 0,
  add column if not exists deposit numeric(12, 2) not null default 0,
  add column if not exists contract_start date,
  add column if not exists contract_end date,
  add column if not exists due_day integer not null default 1,
  add column if not exists status text not null default 'active',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.rent_bills
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists tenancy_id uuid references public.tenancies(id) on delete cascade,
  add column if not exists tenant_id uuid references auth.users(id) on delete cascade,
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists room_id uuid references public.rooms(id) on delete cascade,
  add column if not exists bill_month date,
  add column if not exists due_date date,
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists paid_amount numeric(12, 2) not null default 0,
  add column if not exists status public.bill_status not null default 'unpaid',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.utility_bills
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists tenant_id uuid references auth.users(id) on delete set null,
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists room_id uuid references public.rooms(id) on delete set null,
  add column if not exists utility_type text not null default 'other',
  add column if not exists bill_month date,
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists paid_amount numeric(12, 2) not null default 0,
  add column if not exists status public.bill_status not null default 'unpaid',
  add column if not exists notes text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.payments
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists tenant_id uuid references auth.users(id) on delete set null,
  add column if not exists tenancy_id uuid references public.tenancies(id) on delete set null,
  add column if not exists property_id uuid references public.properties(id) on delete set null,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists room_id uuid references public.rooms(id) on delete set null,
  add column if not exists category text not null default 'other',
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists payment_date date not null default current_date,
  add column if not exists payment_method text not null default 'cash',
  add column if not exists reference_number text,
  add column if not exists notes text,
  add column if not exists status public.payment_status not null default 'confirmed',
  add column if not exists recorded_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.wallet_transactions
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists tenant_id uuid references auth.users(id) on delete cascade,
  add column if not exists transaction_type text not null default 'top_up',
  add column if not exists amount numeric(12, 2) not null default 0,
  add column if not exists reference_number text,
  add column if not exists notes text,
  add column if not exists recorded_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now();

alter table public.maintenance_tickets
  add column if not exists ticket_number text,
  add column if not exists organization_id uuid references public.organizations(id) on delete cascade,
  add column if not exists tenant_id uuid references auth.users(id) on delete cascade,
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists unit_id uuid references public.units(id) on delete set null,
  add column if not exists room_id uuid references public.rooms(id) on delete set null,
  add column if not exists ticket_type public.ticket_type not null default 'maintenance',
  add column if not exists category text,
  add column if not exists description text,
  add column if not exists urgency public.ticket_urgency not null default 'normal',
  add column if not exists status public.ticket_status not null default 'submitted',
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists completed_at timestamptz;

alter table public.maintenance_ticket_assignments
  add column if not exists ticket_id uuid references public.maintenance_tickets(id) on delete cascade,
  add column if not exists assigned_to uuid references auth.users(id) on delete cascade,
  add column if not exists assigned_by uuid references auth.users(id) on delete set null,
  add column if not exists assigned_at timestamptz not null default now(),
  add column if not exists required_completion_date date,
  add column if not exists status text not null default 'assigned';

alter table public.maintenance_updates
  add column if not exists ticket_id uuid references public.maintenance_tickets(id) on delete cascade,
  add column if not exists updated_by uuid references auth.users(id) on delete cascade,
  add column if not exists status public.ticket_status,
  add column if not exists notes text,
  add column if not exists labour_cost numeric(12, 2) not null default 0,
  add column if not exists material_cost numeric(12, 2) not null default 0,
  add column if not exists created_at timestamptz not null default now();

alter table public.maintenance_attachments
  add column if not exists ticket_id uuid references public.maintenance_tickets(id) on delete cascade,
  add column if not exists uploaded_by uuid references auth.users(id) on delete cascade,
  add column if not exists attachment_type text not null default 'problem',
  add column if not exists bucket_name text not null default 'maintenance-attachments',
  add column if not exists file_path text,
  add column if not exists content_type text,
  add column if not exists created_at timestamptz not null default now();

alter table public.claims
  add column if not exists ticket_id uuid references public.maintenance_tickets(id) on delete cascade,
  add column if not exists property_id uuid references public.properties(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists submitted_by uuid references auth.users(id) on delete cascade,
  add column if not exists labour_cost numeric(12, 2) not null default 0,
  add column if not exists material_cost numeric(12, 2) not null default 0,
  add column if not exists description text,
  add column if not exists status public.claim_status not null default 'pending_owner_approval',
  add column if not exists submitted_at timestamptz not null default now(),
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists rejection_reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.claim_attachments
  add column if not exists claim_id uuid references public.claims(id) on delete cascade,
  add column if not exists uploaded_by uuid references auth.users(id) on delete cascade,
  add column if not exists bucket_name text not null default 'claim-attachments',
  add column if not exists file_path text,
  add column if not exists content_type text,
  add column if not exists created_at timestamptz not null default now();

insert into storage.buckets (id, name, public)
values
  ('maintenance-attachments', 'maintenance-attachments', false),
  ('claim-attachments', 'claim-attachments', false)
on conflict (id) do nothing;

create or replace function public.current_profile_role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'role', ''),
    (select profiles.role from public.profiles profiles where profiles.id = auth.uid()),
    'tenant'
  );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
as $$
  select public.current_profile_role() in ('super_admin', 'admin');
$$;

create or replace function public.is_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.organization_members organization_members
    where organization_members.organization_id = target_organization_id
      and organization_members.user_id = auth.uid()
      and organization_members.status = 'active'
  );
$$;

create or replace function public.owns_property(target_property_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.property_owners property_owners
    where property_owners.property_id = target_property_id
      and property_owners.owner_id = auth.uid()
      and (property_owners.end_date is null or property_owners.end_date >= current_date)
  );
$$;

create or replace function public.is_assigned_to_ticket(target_ticket_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.maintenance_ticket_assignments assignments
    where assignments.ticket_id = target_ticket_id
      and assignments.assigned_to = auth.uid()
      and assignments.status <> 'cancelled'
  );
$$;

create or replace function public.can_access_property(target_property_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_platform_admin()
    or public.owns_property(target_property_id)
    or exists (
      select 1
      from public.properties properties
      where properties.id = target_property_id
        and properties.organization_id is not null
        and public.is_organization_member(properties.organization_id)
    );
$$;

create or replace function public.can_access_ticket(target_ticket_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.maintenance_tickets tickets
      where tickets.id = target_ticket_id
        and (
          tickets.tenant_id = auth.uid()
          or public.owns_property(tickets.property_id)
          or public.is_assigned_to_ticket(tickets.id)
        )
    );
$$;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.properties enable row level security;
alter table public.property_owners enable row level security;
alter table public.units enable row level security;
alter table public.rooms enable row level security;
alter table public.tenancies enable row level security;
alter table public.rent_bills enable row level security;
alter table public.utility_bills enable row level security;
alter table public.payments enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.maintenance_tickets enable row level security;
alter table public.maintenance_ticket_assignments enable row level security;
alter table public.maintenance_updates enable row level security;
alter table public.maintenance_attachments enable row level security;
alter table public.claims enable row level security;
alter table public.claim_attachments enable row level security;

drop policy if exists "profiles_select_allowed" on public.profiles;
create policy "profiles_select_allowed" on public.profiles
for select using (
  public.is_platform_admin()
  or id = auth.uid()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles
for insert with check (id = auth.uid() or public.is_platform_admin());

drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles
for update using (id = auth.uid() or public.is_platform_admin())
with check (id = auth.uid() or public.is_platform_admin());

drop policy if exists "organizations_select_allowed" on public.organizations;
create policy "organizations_select_allowed" on public.organizations
for select using (
  public.is_platform_admin()
  or created_by = auth.uid()
  or public.is_organization_member(id)
);

drop policy if exists "organizations_insert_admin_owner" on public.organizations;
create policy "organizations_insert_admin_owner" on public.organizations
for insert with check (
  public.current_profile_role() in ('super_admin', 'admin', 'owner')
  and created_by = auth.uid()
);

drop policy if exists "organizations_update_admin_member" on public.organizations;
create policy "organizations_update_admin_member" on public.organizations
for update using (public.is_platform_admin() or public.is_organization_member(id))
with check (public.is_platform_admin() or public.is_organization_member(id));

drop policy if exists "organization_members_select_allowed" on public.organization_members;
create policy "organization_members_select_allowed" on public.organization_members
for select using (
  public.is_platform_admin()
  or user_id = auth.uid()
  or public.is_organization_member(organization_id)
);

drop policy if exists "organization_members_manage_admin" on public.organization_members;
create policy "organization_members_manage_admin" on public.organization_members
for all using (public.is_platform_admin() or public.is_organization_member(organization_id))
with check (public.is_platform_admin() or public.is_organization_member(organization_id));

drop policy if exists "properties_portal_select" on public.properties;
create policy "properties_portal_select" on public.properties
for select using (public.can_access_property(id));

drop policy if exists "properties_portal_manage" on public.properties;
create policy "properties_portal_manage" on public.properties
for all using (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
)
with check (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "property_owners_select_allowed" on public.property_owners;
create policy "property_owners_select_allowed" on public.property_owners
for select using (
  public.is_platform_admin()
  or owner_id = auth.uid()
  or public.can_access_property(property_id)
);

drop policy if exists "property_owners_manage_admin" on public.property_owners;
create policy "property_owners_manage_admin" on public.property_owners
for all using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "units_select_allowed" on public.units;
create policy "units_select_allowed" on public.units
for select using (public.can_access_property(property_id));

drop policy if exists "units_manage_admin_member" on public.units;
create policy "units_manage_admin_member" on public.units
for all using (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
)
with check (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "rooms_portal_select" on public.rooms;
create policy "rooms_portal_select" on public.rooms
for select using (
  public.can_access_property(property_id)
  or exists (
    select 1
    from public.tenancies tenancies
    where tenancies.room_id = rooms.id
      and tenancies.tenant_id = auth.uid()
      and tenancies.status = 'active'
  )
);

drop policy if exists "rooms_portal_manage" on public.rooms;
create policy "rooms_portal_manage" on public.rooms
for all using (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
)
with check (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "tenancies_select_allowed" on public.tenancies;
create policy "tenancies_select_allowed" on public.tenancies
for select using (
  public.is_platform_admin()
  or tenant_id = auth.uid()
  or public.can_access_property(property_id)
);

drop policy if exists "tenancies_manage_admin_member" on public.tenancies;
create policy "tenancies_manage_admin_member" on public.tenancies
for all using (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
)
with check (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "rent_bills_select_allowed" on public.rent_bills;
create policy "rent_bills_select_allowed" on public.rent_bills
for select using (
  public.is_platform_admin()
  or tenant_id = auth.uid()
  or public.can_access_property(property_id)
);

drop policy if exists "rent_bills_manage_admin_member" on public.rent_bills;
create policy "rent_bills_manage_admin_member" on public.rent_bills
for all using (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
)
with check (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "utility_bills_select_allowed" on public.utility_bills;
create policy "utility_bills_select_allowed" on public.utility_bills
for select using (
  public.is_platform_admin()
  or tenant_id = auth.uid()
  or public.can_access_property(property_id)
);

drop policy if exists "utility_bills_manage_admin_member" on public.utility_bills;
create policy "utility_bills_manage_admin_member" on public.utility_bills
for all using (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
)
with check (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "payments_select_allowed" on public.payments;
create policy "payments_select_allowed" on public.payments
for select using (
  public.is_platform_admin()
  or tenant_id = auth.uid()
  or (property_id is not null and public.can_access_property(property_id))
);

drop policy if exists "payments_manage_admin_member" on public.payments;
create policy "payments_manage_admin_member" on public.payments
for all using (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
)
with check (
  public.is_platform_admin()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "wallet_transactions_select_allowed" on public.wallet_transactions;
create policy "wallet_transactions_select_allowed" on public.wallet_transactions
for select using (
  public.is_platform_admin()
  or tenant_id = auth.uid()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "wallet_transactions_insert_allowed" on public.wallet_transactions;
create policy "wallet_transactions_insert_allowed" on public.wallet_transactions
for insert with check (
  public.is_platform_admin()
  or tenant_id = auth.uid()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "maintenance_tickets_select_allowed" on public.maintenance_tickets;
create policy "maintenance_tickets_select_allowed" on public.maintenance_tickets
for select using (
  public.is_platform_admin()
  or tenant_id = auth.uid()
  or public.owns_property(property_id)
  or public.is_assigned_to_ticket(id)
);

drop policy if exists "maintenance_tickets_insert_tenant_or_admin" on public.maintenance_tickets;
create policy "maintenance_tickets_insert_tenant_or_admin" on public.maintenance_tickets
for insert with check (
  public.is_platform_admin()
  or tenant_id = auth.uid()
  or (
    organization_id is not null
    and public.is_organization_member(organization_id)
  )
);

drop policy if exists "maintenance_tickets_update_assigned_or_admin" on public.maintenance_tickets;
create policy "maintenance_tickets_update_assigned_or_admin" on public.maintenance_tickets
for update using (
  public.is_platform_admin()
  or public.is_assigned_to_ticket(id)
  or public.owns_property(property_id)
)
with check (
  public.is_platform_admin()
  or public.is_assigned_to_ticket(id)
  or public.owns_property(property_id)
);

drop policy if exists "maintenance_assignments_select_allowed" on public.maintenance_ticket_assignments;
create policy "maintenance_assignments_select_allowed" on public.maintenance_ticket_assignments
for select using (
  public.is_platform_admin()
  or assigned_to = auth.uid()
  or public.can_access_ticket(ticket_id)
);

drop policy if exists "maintenance_assignments_manage_admin" on public.maintenance_ticket_assignments;
create policy "maintenance_assignments_manage_admin" on public.maintenance_ticket_assignments
for all using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "maintenance_updates_select_allowed" on public.maintenance_updates;
create policy "maintenance_updates_select_allowed" on public.maintenance_updates
for select using (public.can_access_ticket(ticket_id));

drop policy if exists "maintenance_updates_insert_allowed" on public.maintenance_updates;
create policy "maintenance_updates_insert_allowed" on public.maintenance_updates
for insert with check (
  public.is_platform_admin()
  or public.is_assigned_to_ticket(ticket_id)
);

drop policy if exists "maintenance_attachments_select_allowed" on public.maintenance_attachments;
create policy "maintenance_attachments_select_allowed" on public.maintenance_attachments
for select using (public.can_access_ticket(ticket_id));

drop policy if exists "maintenance_attachments_insert_allowed" on public.maintenance_attachments;
create policy "maintenance_attachments_insert_allowed" on public.maintenance_attachments
for insert with check (
  uploaded_by = auth.uid()
  and public.can_access_ticket(ticket_id)
);

drop policy if exists "claims_select_allowed" on public.claims;
create policy "claims_select_allowed" on public.claims
for select using (
  public.is_platform_admin()
  or owner_id = auth.uid()
  or submitted_by = auth.uid()
  or public.can_access_ticket(ticket_id)
);

drop policy if exists "claims_insert_assigned_staff" on public.claims;
create policy "claims_insert_assigned_staff" on public.claims
for insert with check (
  submitted_by = auth.uid()
  and (
    public.is_platform_admin()
    or public.is_assigned_to_ticket(ticket_id)
  )
);

drop policy if exists "claims_update_owner_admin_staff" on public.claims;
create policy "claims_update_owner_admin_staff" on public.claims
for update using (
  public.is_platform_admin()
  or owner_id = auth.uid()
  or submitted_by = auth.uid()
)
with check (
  public.is_platform_admin()
  or owner_id = auth.uid()
  or submitted_by = auth.uid()
);

drop policy if exists "claim_attachments_select_allowed" on public.claim_attachments;
create policy "claim_attachments_select_allowed" on public.claim_attachments
for select using (
  exists (
    select 1 from public.claims claims
    where claims.id = claim_attachments.claim_id
      and (
        public.is_platform_admin()
        or claims.owner_id = auth.uid()
        or claims.submitted_by = auth.uid()
        or public.can_access_ticket(claims.ticket_id)
      )
  )
);

drop policy if exists "claim_attachments_insert_allowed" on public.claim_attachments;
create policy "claim_attachments_insert_allowed" on public.claim_attachments
for insert with check (
  uploaded_by = auth.uid()
  and exists (
    select 1 from public.claims claims
    where claims.id = claim_attachments.claim_id
      and (
        public.is_platform_admin()
        or claims.owner_id = auth.uid()
        or claims.submitted_by = auth.uid()
      )
  )
);

drop policy if exists "storage_maintenance_select_allowed" on storage.objects;
create policy "storage_maintenance_select_allowed" on storage.objects
for select using (
  bucket_id = 'maintenance-attachments'
  and exists (
    select 1
    from public.maintenance_attachments attachments
    where attachments.file_path = storage.objects.name
      and public.can_access_ticket(attachments.ticket_id)
  )
);

drop policy if exists "storage_maintenance_insert_allowed" on storage.objects;
create policy "storage_maintenance_insert_allowed" on storage.objects
for insert with check (
  bucket_id = 'maintenance-attachments'
  and auth.uid() is not null
);

drop policy if exists "storage_claim_select_allowed" on storage.objects;
create policy "storage_claim_select_allowed" on storage.objects
for select using (
  bucket_id = 'claim-attachments'
  and exists (
    select 1
    from public.claim_attachments attachments
    join public.claims claims on claims.id = attachments.claim_id
    where attachments.file_path = storage.objects.name
      and (
        public.is_platform_admin()
        or claims.owner_id = auth.uid()
        or claims.submitted_by = auth.uid()
        or public.can_access_ticket(claims.ticket_id)
      )
  )
);

drop policy if exists "storage_claim_insert_allowed" on storage.objects;
create policy "storage_claim_insert_allowed" on storage.objects
for insert with check (
  bucket_id = 'claim-attachments'
  and auth.uid() is not null
);
