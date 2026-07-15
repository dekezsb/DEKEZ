do $$
begin
  if not exists (select 1 from pg_type where typname = 'agreement_status') then
    create type public.agreement_status as enum (
      'draft',
      'pending_signature',
      'signed',
      'expiring_soon',
      'renewal_pending',
      'renewal_sent',
      'renewal_signed',
      'expired',
      'terminated'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'agreement_type') then
    create type public.agreement_type as enum ('original', 'renewal');
  end if;
end $$;

create table if not exists public.tenancy_agreement_templates (
  id uuid primary key default gen_random_uuid(),
  property_id uuid references public.properties(id) on delete cascade,
  name text not null,
  template_content text not null,
  version integer not null default 1,
  is_active boolean not null default true,
  uploaded_file_url text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.properties
  add column if not exists default_ta_template_id uuid references public.tenancy_agreement_templates(id) on delete set null,
  add column if not exists default_contract_duration_months integer not null default 12 check (default_contract_duration_months in (6, 12));

alter table public.tenancies
  add column if not exists tenancy_start_date date,
  add column if not exists tenancy_end_date date,
  add column if not exists contract_duration_months integer check (contract_duration_months in (6, 12)),
  add column if not exists renewal_status text;

update public.tenancies
set tenancy_start_date = contract_start
where tenancy_start_date is null
  and contract_start is not null;

update public.tenancies
set tenancy_end_date = contract_end
where tenancy_end_date is null
  and contract_end is not null;

update public.tenancies
set contract_duration_months = case
  when contract_start is not null and contract_end is not null and contract_end <= contract_start + interval '7 months' then 6
  else 12
end
where contract_duration_months is null;

create table if not exists public.tenancy_agreements (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  template_id uuid references public.tenancy_agreement_templates(id) on delete set null,
  agreement_type public.agreement_type not null default 'original',
  version_number integer not null default 1,
  status public.agreement_status not null default 'draft',
  rendered_content text not null,
  generated_at timestamptz not null default now(),
  signed_at timestamptz,
  pdf_url text,
  previous_agreement_id uuid references public.tenancy_agreements(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenancy_agreement_signatures (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.tenancy_agreements(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  signature_url text not null,
  signed_at timestamptz not null default now(),
  ip_address text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.tenancy_renewals (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid not null references public.tenancies(id) on delete cascade,
  selected_duration_months integer check (selected_duration_months in (6, 12)),
  renewal_status text not null default 'renewal_pending',
  new_start_date date,
  new_end_date date,
  new_agreement_id uuid references public.tenancy_agreements(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agreement_notifications (
  id uuid primary key default gen_random_uuid(),
  tenancy_id uuid references public.tenancies(id) on delete cascade,
  agreement_id uuid references public.tenancy_agreements(id) on delete cascade,
  notification_type text not null,
  status text not null default 'pending',
  due_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

insert into storage.buckets (id, name, public)
values
  ('tenancy-agreements', 'tenancy-agreements', false),
  ('tenancy-signatures', 'tenancy-signatures', false)
on conflict (id) do nothing;

create or replace function public.calculate_tenancy_end_date(start_date date, duration_months integer)
returns date
language sql
immutable
as $$
  select (start_date + make_interval(months => duration_months))::date;
$$;

create or replace function public.refresh_tenancy_agreement_expiry()
returns void
language plpgsql
security definer
as $$
begin
  update public.tenancy_agreements agreements
  set status = case
    when tenancies.tenancy_end_date < current_date then 'expired'::public.agreement_status
    when tenancies.tenancy_end_date <= current_date + interval '14 days' then 'renewal_pending'::public.agreement_status
    when tenancies.tenancy_end_date <= current_date + interval '30 days' then 'expiring_soon'::public.agreement_status
    else agreements.status
  end,
  updated_at = now()
  from public.tenancies tenancies
  where agreements.tenancy_id = tenancies.id
    and agreements.status in ('pending_signature', 'signed', 'expiring_soon', 'renewal_pending')
    and tenancies.tenancy_end_date is not null;

  insert into public.agreement_notifications (tenancy_id, agreement_id, notification_type, status, due_at)
  select agreements.tenancy_id, agreements.id, 'renewal_30_days', 'pending', now()
  from public.tenancy_agreements agreements
  join public.tenancies tenancies on tenancies.id = agreements.tenancy_id
  where tenancies.tenancy_end_date <= current_date + interval '30 days'
    and tenancies.tenancy_end_date >= current_date
    and not exists (
      select 1 from public.agreement_notifications notifications
      where notifications.agreement_id = agreements.id
        and notifications.notification_type = 'renewal_30_days'
    );
end;
$$;

alter table public.tenancy_agreement_templates enable row level security;
alter table public.tenancy_agreements enable row level security;
alter table public.tenancy_agreement_signatures enable row level security;
alter table public.tenancy_renewals enable row level security;
alter table public.agreement_notifications enable row level security;

drop policy if exists "ta_templates_select_allowed" on public.tenancy_agreement_templates;
create policy "ta_templates_select_allowed" on public.tenancy_agreement_templates
for select using (public.is_platform_admin() or public.can_access_property(property_id));

drop policy if exists "ta_templates_manage_allowed" on public.tenancy_agreement_templates;
create policy "ta_templates_manage_allowed" on public.tenancy_agreement_templates
for all using (public.is_platform_admin() or public.can_access_property(property_id))
with check (public.is_platform_admin() or public.can_access_property(property_id));

drop policy if exists "tenancy_agreements_select_allowed" on public.tenancy_agreements;
create policy "tenancy_agreements_select_allowed" on public.tenancy_agreements
for select using (
  public.is_platform_admin()
  or exists (
    select 1 from public.tenancies tenancies
    where tenancies.id = tenancy_agreements.tenancy_id
      and (tenancies.tenant_id = auth.uid() or public.can_access_property(tenancies.property_id))
  )
);

drop policy if exists "tenancy_agreements_manage_admin_owner" on public.tenancy_agreements;
create policy "tenancy_agreements_manage_admin_owner" on public.tenancy_agreements
for all using (
  public.is_platform_admin()
  or exists (
    select 1 from public.tenancies tenancies
    where tenancies.id = tenancy_agreements.tenancy_id
      and public.can_access_property(tenancies.property_id)
  )
)
with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.tenancies tenancies
    where tenancies.id = tenancy_agreements.tenancy_id
      and public.can_access_property(tenancies.property_id)
  )
);

drop policy if exists "ta_signatures_select_allowed" on public.tenancy_agreement_signatures;
create policy "ta_signatures_select_allowed" on public.tenancy_agreement_signatures
for select using (
  tenant_id = auth.uid()
  or public.is_platform_admin()
  or exists (
    select 1
    from public.tenancy_agreements agreements
    join public.tenancies tenancies on tenancies.id = agreements.tenancy_id
    where agreements.id = tenancy_agreement_signatures.agreement_id
      and public.can_access_property(tenancies.property_id)
  )
);

drop policy if exists "ta_signatures_insert_tenant" on public.tenancy_agreement_signatures;
create policy "ta_signatures_insert_tenant" on public.tenancy_agreement_signatures
for insert with check (tenant_id = auth.uid());

drop policy if exists "tenancy_renewals_select_allowed" on public.tenancy_renewals;
create policy "tenancy_renewals_select_allowed" on public.tenancy_renewals
for select using (
  public.is_platform_admin()
  or exists (
    select 1 from public.tenancies tenancies
    where tenancies.id = tenancy_renewals.tenancy_id
      and (tenancies.tenant_id = auth.uid() or public.can_access_property(tenancies.property_id))
  )
);

drop policy if exists "tenancy_renewals_manage_allowed" on public.tenancy_renewals;
create policy "tenancy_renewals_manage_allowed" on public.tenancy_renewals
for all using (
  public.is_platform_admin()
  or exists (
    select 1 from public.tenancies tenancies
    where tenancies.id = tenancy_renewals.tenancy_id
      and (tenancies.tenant_id = auth.uid() or public.can_access_property(tenancies.property_id))
  )
)
with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.tenancies tenancies
    where tenancies.id = tenancy_renewals.tenancy_id
      and (tenancies.tenant_id = auth.uid() or public.can_access_property(tenancies.property_id))
  )
);
