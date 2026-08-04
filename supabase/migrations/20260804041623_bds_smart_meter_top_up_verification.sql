-- BDS pilot: bank-slip electricity top-ups require Admin verification before
-- any physical smart-meter credit can be recorded.
create table if not exists public.smart_meter_top_up_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  tenancy_id uuid not null references public.tenancies(id) on delete restrict,
  tenant_record_id uuid not null references public.tenants(id) on delete restrict,
  tenant_profile_id uuid not null references auth.users(id) on delete restrict,
  meter_id uuid references public.smart_meters(id) on delete restrict,
  amount numeric(12, 2) not null,
  payment_slip_bucket text not null default 'smart-meter-top-up-slips',
  payment_slip_path text not null,
  payment_slip_name text not null,
  payment_slip_type text,
  status text not null default 'pending_verification',
  rejection_reason text,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  credited_by uuid references auth.users(id) on delete set null,
  credited_at timestamptz,
  provider_reference text,
  credit_before numeric(12, 2),
  credit_after numeric(12, 2),
  retain_until date not null default ((current_date + interval '7 years')::date),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint smart_meter_top_up_amount_check
    check (amount between 10 and 500 and amount = trunc(amount)),
  constraint smart_meter_top_up_status_check
    check (
      status in (
        'pending_verification',
        'rejected',
        'approved_awaiting_top_up',
        'credited',
        'failed'
      )
    ),
  constraint smart_meter_top_up_rejection_check
    check (status <> 'rejected' or nullif(btrim(rejection_reason), '') is not null),
  constraint smart_meter_top_up_credit_check
    check (
      status <> 'credited'
      or (
        credited_at is not null
        and nullif(btrim(provider_reference), '') is not null
        and credit_before is not null
        and credit_after is not null
      )
    )
);

create unique index if not exists smart_meter_top_up_one_open_request_idx
  on public.smart_meter_top_up_requests (tenant_profile_id, room_id)
  where status in ('pending_verification', 'approved_awaiting_top_up');

create unique index if not exists smart_meter_top_up_provider_reference_idx
  on public.smart_meter_top_up_requests (provider_reference)
  where provider_reference is not null;

create index if not exists smart_meter_top_up_admin_queue_idx
  on public.smart_meter_top_up_requests (status, created_at desc);

create index if not exists smart_meter_top_up_tenant_history_idx
  on public.smart_meter_top_up_requests (tenant_profile_id, created_at desc);

alter table public.smart_meter_top_up_requests enable row level security;

drop policy if exists "smart_meter_top_up_select_allowed"
  on public.smart_meter_top_up_requests;
drop policy if exists "smart_meter_top_up_insert_own_bds"
  on public.smart_meter_top_up_requests;
drop policy if exists "smart_meter_top_up_manage_property"
  on public.smart_meter_top_up_requests;

create policy "smart_meter_top_up_select_allowed"
on public.smart_meter_top_up_requests
for select
to authenticated
using (
  tenant_profile_id = (select auth.uid())
  or public.can_manage_property_expenses(property_id)
);

create policy "smart_meter_top_up_insert_own_bds"
on public.smart_meter_top_up_requests
for insert
to authenticated
with check (
  tenant_profile_id = (select auth.uid())
  and status = 'pending_verification'
  and exists (
    select 1
    from public.tenancies as tenancy
    join public.tenants as tenant on tenant.id = tenancy.tenant_id
    join public.properties as property on property.id = tenancy.property_id
    where tenancy.id = smart_meter_top_up_requests.tenancy_id
      and tenancy.room_id = smart_meter_top_up_requests.room_id
      and tenancy.property_id = smart_meter_top_up_requests.property_id
      and tenant.id = smart_meter_top_up_requests.tenant_record_id
      and tenant.profile_id = (select auth.uid())
      and tenancy.status = 'active'
      and upper(coalesce(property.property_code, '')) = 'BDS'
  )
);

create policy "smart_meter_top_up_manage_property"
on public.smart_meter_top_up_requests
for update
to authenticated
using (public.can_manage_property_expenses(property_id))
with check (public.can_manage_property_expenses(property_id));

grant select, insert, update on public.smart_meter_top_up_requests to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'smart-meter-top-up-slips',
  'smart-meter-top-up-slips',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "smart_meter_top_up_slips_insert_own" on storage.objects;
drop policy if exists "smart_meter_top_up_slips_select_allowed" on storage.objects;

create policy "smart_meter_top_up_slips_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'smart-meter-top-up-slips'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "smart_meter_top_up_slips_select_allowed"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'smart-meter-top-up-slips'
  and (
    (storage.foldername(name))[1] = (select auth.uid())::text
    or exists (
      select 1
      from public.smart_meter_top_up_requests as request
      where request.payment_slip_path = storage.objects.name
        and public.can_manage_property_expenses(request.property_id)
    )
  )
);

create or replace function public.confirm_smart_meter_top_up_credit(
  request_id uuid,
  reviewer_id uuid,
  external_reference text
)
returns public.smart_meter_top_up_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_request public.smart_meter_top_up_requests;
  target_meter public.smart_meters;
  updated_request public.smart_meter_top_up_requests;
  previous_credit numeric(12, 2);
  next_credit numeric(12, 2);
begin
  if nullif(btrim(external_reference), '') is null then
    raise exception 'provider_reference_required';
  end if;

  select request.*
  into target_request
  from public.smart_meter_top_up_requests as request
  where request.id = request_id
  for update;

  if target_request.id is null
    or target_request.status <> 'approved_awaiting_top_up' then
    raise exception 'top_up_request_not_ready';
  end if;

  select meter.*
  into target_meter
  from public.smart_meters as meter
  where (
      meter.id = target_request.meter_id
      or (
        target_request.meter_id is null
        and meter.room_id = target_request.room_id
      )
    )
    and meter.meter_type = 'electricity'
    and meter.status = 'active'
  order by (meter.id = target_request.meter_id) desc, meter.updated_at desc
  limit 1
  for update;

  if target_meter.id is null then
    raise exception 'active_electricity_meter_required';
  end if;

  previous_credit := target_meter.remaining_credit;
  next_credit := previous_credit + target_request.amount;

  update public.smart_meters
  set
    tenant_id = target_request.tenant_record_id,
    tenancy_id = target_request.tenancy_id,
    remaining_credit = next_credit,
    updated_at = now()
  where id = target_meter.id;

  update public.smart_meter_top_up_requests
  set
    meter_id = target_meter.id,
    status = 'credited',
    provider_reference = btrim(external_reference),
    credited_by = reviewer_id,
    credited_at = now(),
    credit_before = previous_credit,
    credit_after = next_credit,
    updated_at = now()
  where id = target_request.id
  returning * into updated_request;

  return updated_request;
end;
$$;

revoke all on function public.confirm_smart_meter_top_up_credit(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.confirm_smart_meter_top_up_credit(uuid, uuid, text)
  to service_role;
