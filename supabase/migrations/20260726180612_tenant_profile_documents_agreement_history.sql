alter table public.tenant_documents
  add column if not exists uploaded_by uuid references auth.users(id) on delete set null;

create index if not exists tenant_documents_uploaded_by_idx
  on public.tenant_documents (uploaded_by);

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]::text[]
where id = 'tenant-documents';

alter table public.tenancy_agreements
  add column if not exists term_start_date date,
  add column if not exists term_end_date date,
  add column if not exists tenant_name_snapshot text,
  add column if not exists property_name_snapshot text,
  add column if not exists room_name_snapshot text;

update public.tenancy_agreements as agreements
set
  term_start_date = coalesce(
    agreements.term_start_date,
    tenancies.tenancy_start_date,
    tenancies.contract_start,
    tenancies.start_date
  ),
  term_end_date = coalesce(
    agreements.term_end_date,
    tenancies.tenancy_end_date,
    tenancies.contract_end,
    tenancies.end_date
  ),
  tenant_name_snapshot = coalesce(
    agreements.tenant_name_snapshot,
    tenants.full_name
  ),
  property_name_snapshot = coalesce(
    agreements.property_name_snapshot,
    properties.name
  ),
  room_name_snapshot = coalesce(
    agreements.room_name_snapshot,
    rooms.room_number,
    rooms.name
  )
from public.tenancies as tenancies
left join public.tenants as tenants
  on tenants.id = tenancies.tenant_id
left join public.properties as properties
  on properties.id = tenancies.property_id
left join public.rooms as rooms
  on rooms.id = tenancies.room_id
where tenancies.id = agreements.tenancy_id;

create index if not exists tenancy_agreements_tenancy_term_idx
  on public.tenancy_agreements (
    tenancy_id,
    term_start_date desc,
    generated_at desc
  );

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
      or new.rendered_content is distinct from old.rendered_content
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

drop trigger if exists protect_signed_tenancy_agreement_history
  on public.tenancy_agreements;

create trigger protect_signed_tenancy_agreement_history
before update or delete on public.tenancy_agreements
for each row
execute function public.protect_signed_tenancy_agreement_history();

drop policy if exists "tenancy_agreements_select_allowed"
  on public.tenancy_agreements;

create policy "tenancy_agreements_select_allowed"
on public.tenancy_agreements
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.tenancies as tenancies
    join public.tenants as tenants
      on tenants.id = tenancies.tenant_id
    where tenancies.id = tenancy_agreements.tenancy_id
      and (
        tenants.profile_id = auth.uid()
        or public.can_access_property(tenancies.property_id)
      )
  )
);

drop policy if exists "tenancy_agreements_manage_admin_owner"
  on public.tenancy_agreements;
drop policy if exists "tenancy_agreements_manage_admin"
  on public.tenancy_agreements;

create policy "tenancy_agreements_manage_admin"
on public.tenancy_agreements
for all
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.tenancies as tenancies
    where tenancies.id = tenancy_agreements.tenancy_id
      and public.can_manage_property(tenancies.property_id)
  )
)
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.tenancies as tenancies
    where tenancies.id = tenancy_agreements.tenancy_id
      and public.can_manage_property(tenancies.property_id)
  )
);

drop policy if exists "ta_signatures_insert_tenant"
  on public.tenancy_agreement_signatures;

create policy "ta_signatures_insert_tenant"
on public.tenancy_agreement_signatures
for insert
to authenticated
with check (
  tenant_id = auth.uid()
  and exists (
    select 1
    from public.tenancy_agreements as agreements
    join public.tenancies as tenancies
      on tenancies.id = agreements.tenancy_id
    join public.tenants as tenants
      on tenants.id = tenancies.tenant_id
    where agreements.id = tenancy_agreement_signatures.agreement_id
      and tenants.profile_id = auth.uid()
  )
);
