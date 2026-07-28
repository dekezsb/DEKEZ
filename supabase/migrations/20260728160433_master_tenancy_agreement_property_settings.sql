create table if not exists public.property_tenancy_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  property_type text not null default 'residential_room'
    check (property_type in ('residential_room', 'whole_house', 'office', 'shop_lot')),
  facilities jsonb not null default '{}'::jsonb
    check (jsonb_typeof(facilities) = 'object'),
  water_mode text not null default 'included'
    check (water_mode in ('included', 'tenant_pays', 'smart_meter')),
  electricity_mode text not null default 'included'
    check (electricity_mode in ('included', 'tenant_pays', 'smart_meter')),
  air_conditioner_mode text not null default 'smart_meter'
    check (
      air_conditioner_mode in (
        'included',
        'smart_meter',
        'monthly_free_quota',
        'none'
      )
    ),
  air_conditioner_free_quota_kwh numeric(12, 2)
    check (
      air_conditioner_free_quota_kwh is null
      or air_conditioner_free_quota_kwh >= 0
    ),
  optional_clauses jsonb not null default '{}'::jsonb
    check (jsonb_typeof(optional_clauses) = 'object'),
  inventory jsonb not null default '[]'::jsonb
    check (jsonb_typeof(inventory) = 'array'),
  emergency_contact_name text,
  emergency_contact_phone text,
  key_handover_notes text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenancy_agreement_templates_one_global_version
  on public.tenancy_agreement_templates (name, version)
  where property_id is null;

alter table public.property_tenancy_settings enable row level security;

grant select, insert, update, delete
  on table public.property_tenancy_settings
  to authenticated;

drop policy if exists "property_tenancy_settings_select_scope"
  on public.property_tenancy_settings;
create policy "property_tenancy_settings_select_scope"
on public.property_tenancy_settings
for select
to authenticated
using ((select public.can_access_property(property_id)));

drop policy if exists "property_tenancy_settings_insert_admin"
  on public.property_tenancy_settings;
create policy "property_tenancy_settings_insert_admin"
on public.property_tenancy_settings
for insert
to authenticated
with check (
  (select public.is_platform_admin())
  and (select public.can_access_property(property_id))
);

drop policy if exists "property_tenancy_settings_update_admin"
  on public.property_tenancy_settings;
create policy "property_tenancy_settings_update_admin"
on public.property_tenancy_settings
for update
to authenticated
using (
  (select public.is_platform_admin())
  and (select public.can_access_property(property_id))
)
with check (
  (select public.is_platform_admin())
  and (select public.can_access_property(property_id))
);

drop policy if exists "property_tenancy_settings_delete_admin"
  on public.property_tenancy_settings;
create policy "property_tenancy_settings_delete_admin"
on public.property_tenancy_settings
for delete
to authenticated
using (
  (select public.is_platform_admin())
  and (select public.can_access_property(property_id))
);

-- Existing rendered agreements keep their original template reference and content.
-- These rows are only retired from future agreement generation.
update public.tenancy_agreement_templates
set
  is_active = false,
  updated_at = now()
where property_id is not null
  and is_active;

update public.properties
set
  default_ta_template_id = null,
  updated_at = now()
where default_ta_template_id is not null;
