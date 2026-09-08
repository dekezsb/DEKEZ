-- Commercial offices always require two months of security deposit plus
-- one-half month of utility deposit. Align only current active tenancy
-- requirements; historical applications, invoices and payments stay intact.
with commercial_requirements as (
  select
    t.id,
    round(
      coalesce(t.monthly_rental, t.monthly_rent, r.monthly_rent, 0)::numeric
        * 2.5,
      2
    ) as required_deposit
  from public.tenancies t
  join public.properties p on p.id = t.property_id
  join public.rooms r on r.id = t.room_id
  where p.is_commercial is true
    and t.status = 'active'
    and t.checkout_date is null
    and coalesce(t.monthly_rental, t.monthly_rent, r.monthly_rent, 0) > 0
)
update public.tenancies t
set deposit = requirement.required_deposit
from commercial_requirements requirement
where t.id = requirement.id
  and t.deposit is distinct from requirement.required_deposit;

update public.tenant_records record
set deposit = tenancy.deposit
from public.tenancies tenancy
join public.properties property on property.id = tenancy.property_id
where record.tenancy_id = tenancy.id
  and property.is_commercial is true
  and tenancy.status = 'active'
  and tenancy.checkout_date is null
  and record.status = 'active'
  and record.deposit is distinct from tenancy.deposit;
