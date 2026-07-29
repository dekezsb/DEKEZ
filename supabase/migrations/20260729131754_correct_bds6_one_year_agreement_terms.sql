-- BDS Room 6 is a commercial room. Its one-year original term must run
-- 01/07/2025 through 30/06/2026, with the renewal beginning the next day.
with duplicate_original as (
  select agreements.*
  from public.tenancy_agreements agreements
  join public.tenancies tenancies
    on tenancies.id = agreements.tenancy_id
  join public.properties properties
    on properties.id = tenancies.property_id
  join public.rooms rooms
    on rooms.id = tenancies.room_id
  where properties.property_code = 'BDS'
    and regexp_replace(rooms.room_number, '^Room\s*', '', 'i') = '6'
    and agreements.term_type = 'original'
    and agreements.term_start_date = date '2025-08-01'
    and agreements.signed_at is null
    and agreements.status::text not in ('signed', 'renewal_signed')
),
audit_actor as (
  select profiles.id
  from public.profiles profiles
  where profiles.role::text = 'super_admin'
  order by profiles.created_at
  limit 1
)
insert into public.tenancy_agreement_deletion_logs (
  agreement_id,
  tenancy_id,
  performed_by,
  reason,
  original_agreement
)
select
  duplicate_original.id,
  duplicate_original.tenancy_id,
  audit_actor.id,
  'Removed duplicate BDS Room 6 original term created with an incorrect August start date',
  to_jsonb(duplicate_original)
from duplicate_original
cross join audit_actor;

delete from public.tenancy_agreements agreements
using public.tenancies tenancies,
      public.properties properties,
      public.rooms rooms
where tenancies.id = agreements.tenancy_id
  and properties.id = tenancies.property_id
  and rooms.id = tenancies.room_id
  and properties.property_code = 'BDS'
  and regexp_replace(rooms.room_number, '^Room\s*', '', 'i') = '6'
  and agreements.term_type = 'original'
  and agreements.term_start_date = date '2025-08-01'
  and agreements.signed_at is null
  and agreements.status::text not in ('signed', 'renewal_signed');

update public.tenancy_agreements agreements
set
  term_end_date = date '2026-06-30',
  rendered_content = replace(
    agreements.rendered_content,
    '31/07/2026',
    '30/06/2026'
  )
from public.tenancies tenancies,
     public.properties properties,
     public.rooms rooms
where tenancies.id = agreements.tenancy_id
  and properties.id = tenancies.property_id
  and rooms.id = tenancies.room_id
  and properties.property_code = 'BDS'
  and regexp_replace(rooms.room_number, '^Room\s*', '', 'i') = '6'
  and agreements.term_type = 'original'
  and agreements.term_start_date = date '2025-07-01'
  and agreements.signed_at is null
  and agreements.status::text not in ('signed', 'renewal_signed');

update public.tenancy_agreements agreements
set
  term_start_date = date '2026-07-01',
  term_end_date = date '2027-06-30',
  rendered_content = replace(
    replace(
      agreements.rendered_content,
      '01/08/2026',
      '01/07/2026'
    ),
    '31/07/2027',
    '30/06/2027'
  )
from public.tenancies tenancies,
     public.properties properties,
     public.rooms rooms
where tenancies.id = agreements.tenancy_id
  and properties.id = tenancies.property_id
  and rooms.id = tenancies.room_id
  and properties.property_code = 'BDS'
  and regexp_replace(rooms.room_number, '^Room\s*', '', 'i') = '6'
  and agreements.term_type = 'renewal'
  and agreements.term_start_date = date '2026-08-01'
  and agreements.signed_at is null
  and agreements.status::text not in ('signed', 'renewal_signed');

update public.tenancy_renewals renewals
set
  new_start_date = date '2026-07-01',
  new_end_date = date '2027-06-30',
  updated_at = now()
from public.tenancy_agreements agreements,
     public.tenancies tenancies,
     public.properties properties,
     public.rooms rooms
where agreements.id = renewals.new_agreement_id
  and tenancies.id = agreements.tenancy_id
  and properties.id = tenancies.property_id
  and rooms.id = tenancies.room_id
  and properties.property_code = 'BDS'
  and regexp_replace(rooms.room_number, '^Room\s*', '', 'i') = '6'
  and agreements.term_type = 'renewal'
  and agreements.term_start_date = date '2026-07-01';
