alter table public.tenancy_agreements
  add column if not exists monthly_rent_snapshot numeric(12, 2);

alter table public.tenancy_renewals
  add column if not exists new_monthly_rent numeric(12, 2);

update public.tenancy_agreements
set monthly_rent_snapshot = nullif(
  replace(
    substring(
      rendered_content
      from '(?i)Monthly Rent:[[:space:]]*(?:RM|MYR)?[[:space:]]*([0-9,]+(?:\.[0-9]{1,2})?)'
    ),
    ',',
    ''
  ),
  ''
)::numeric
where monthly_rent_snapshot is null
  and rendered_content ~* 'Monthly Rent:';

update public.tenancy_agreements as agreements
set
  monthly_rent_snapshot = 500.00,
  rendered_content = regexp_replace(
    agreements.rendered_content,
    'Monthly Rent:[^\r\n]*',
    'Monthly Rent: RM 500.00',
    'i'
  ),
  updated_at = now()
from public.tenancies as tenancies
join public.properties as properties
  on properties.id = tenancies.property_id
join public.rooms as rooms
  on rooms.id = tenancies.room_id
where agreements.tenancy_id = tenancies.id
  and upper(coalesce(properties.property_code, '')) = 'BDS'
  and regexp_replace(
    coalesce(rooms.room_number, rooms.name, ''),
    '[^0-9]',
    '',
    'g'
  ) = '6'
  and agreements.agreement_type = 'original'
  and agreements.term_start_date = date '2025-08-01'
  and agreements.term_end_date = date '2026-07-31'
  and agreements.signed_at is null
  and agreements.status::text not in ('signed', 'renewal_signed');

update public.tenancy_agreements as agreements
set monthly_rent_snapshot = coalesce(
  agreements.monthly_rent_snapshot,
  tenancies.monthly_rental
)
from public.tenancies as tenancies
where agreements.tenancy_id = tenancies.id
  and agreements.monthly_rent_snapshot is null;

update public.tenancy_renewals as renewals
set new_monthly_rent = agreements.monthly_rent_snapshot
from public.tenancy_agreements as agreements
where agreements.id = renewals.new_agreement_id
  and renewals.new_monthly_rent is null;

alter table public.tenancy_agreements
  drop constraint if exists tenancy_agreements_monthly_rent_snapshot_check;

alter table public.tenancy_agreements
  add constraint tenancy_agreements_monthly_rent_snapshot_check
  check (
    monthly_rent_snapshot is null
    or monthly_rent_snapshot >= 0
  );

alter table public.tenancy_renewals
  drop constraint if exists tenancy_renewals_new_monthly_rent_check;

alter table public.tenancy_renewals
  add constraint tenancy_renewals_new_monthly_rent_check
  check (
    new_monthly_rent is null
    or new_monthly_rent >= 0
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
      or new.agreement_type is distinct from old.agreement_type
      or new.version_number is distinct from old.version_number
      or new.rendered_content is distinct from old.rendered_content
      or new.monthly_rent_snapshot is distinct from old.monthly_rent_snapshot
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
