create extension if not exists "pgcrypto";

do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum (
      'super_admin',
      'owner',
      'admin',
      'technician',
      'tenant'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'company_status') then
    create type public.company_status as enum ('active', 'inactive', 'suspended');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'company_user_status') then
    create type public.company_user_status as enum ('active', 'inactive', 'invited');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'room_status') then
    create type public.room_status as enum (
      'vacant',
      'occupied',
      'maintenance',
      'reserved'
    );
  end if;
end $$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  status public.company_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  status public.company_user_status not null default 'active',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, user_id)
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  address text not null,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  status public.room_status not null default 'vacant',
  monthly_rent numeric(12, 2) not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (property_id, name)
);

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
as $$
  select nullif(auth.jwt() -> 'user_metadata' ->> 'role', '')::public.app_role;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select public.current_app_role() = 'super_admin';
$$;

create or replace function public.is_company_member(target_company_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.company_users company_users
    where company_users.company_id = target_company_id
      and company_users.user_id = auth.uid()
      and company_users.status = 'active'
  );
$$;

create or replace function public.can_manage_company(target_company_id uuid)
returns boolean
language sql
stable
as $$
  select public.is_super_admin()
    or exists (
      select 1
      from public.company_users company_users
      where company_users.company_id = target_company_id
        and company_users.user_id = auth.uid()
        and company_users.status = 'active'
        and company_users.role in ('owner', 'admin')
    );
$$;

alter table public.companies enable row level security;
alter table public.company_users enable row level security;
alter table public.properties enable row level security;
alter table public.rooms enable row level security;

drop policy if exists "companies_select_access" on public.companies;
create policy "companies_select_access"
on public.companies for select
using (
  public.is_super_admin()
  or created_by = auth.uid()
  or public.is_company_member(id)
);

drop policy if exists "companies_insert_owner" on public.companies;
create policy "companies_insert_owner"
on public.companies for insert
with check (
  public.current_app_role() in ('owner', 'super_admin')
  and created_by = auth.uid()
);

drop policy if exists "companies_update_manager" on public.companies;
create policy "companies_update_manager"
on public.companies for update
using (public.can_manage_company(id))
with check (public.can_manage_company(id));

drop policy if exists "company_users_select_access" on public.company_users;
create policy "company_users_select_access"
on public.company_users for select
using (
  public.is_super_admin()
  or user_id = auth.uid()
  or public.is_company_member(company_id)
);

drop policy if exists "company_users_insert_manager" on public.company_users;
create policy "company_users_insert_manager"
on public.company_users for insert
with check (
  public.is_super_admin()
  or public.can_manage_company(company_id)
  or (
    user_id = auth.uid()
    and role = 'owner'
    and exists (
      select 1
      from public.companies companies
      where companies.id = company_id
        and companies.created_by = auth.uid()
    )
  )
);

drop policy if exists "company_users_update_manager" on public.company_users;
create policy "company_users_update_manager"
on public.company_users for update
using (public.is_super_admin() or public.can_manage_company(company_id))
with check (public.is_super_admin() or public.can_manage_company(company_id));

drop policy if exists "properties_select_access" on public.properties;
create policy "properties_select_access"
on public.properties for select
using (public.is_super_admin() or public.is_company_member(company_id));

drop policy if exists "properties_insert_manager" on public.properties;
create policy "properties_insert_manager"
on public.properties for insert
with check (public.can_manage_company(company_id) and created_by = auth.uid());

drop policy if exists "properties_update_manager" on public.properties;
create policy "properties_update_manager"
on public.properties for update
using (public.can_manage_company(company_id))
with check (public.can_manage_company(company_id));

drop policy if exists "rooms_select_access" on public.rooms;
create policy "rooms_select_access"
on public.rooms for select
using (public.is_super_admin() or public.is_company_member(company_id));

drop policy if exists "rooms_insert_manager" on public.rooms;
create policy "rooms_insert_manager"
on public.rooms for insert
with check (public.can_manage_company(company_id) and created_by = auth.uid());

drop policy if exists "rooms_update_manager" on public.rooms;
create policy "rooms_update_manager"
on public.rooms for update
using (public.can_manage_company(company_id))
with check (public.can_manage_company(company_id));
