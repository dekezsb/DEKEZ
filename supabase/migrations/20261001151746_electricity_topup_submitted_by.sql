-- Track which profile actually submitted an electricity top-up request, so
-- a staff-assisted submission (on behalf of a tenant who can't self-serve)
-- can be told apart from a tenant's own submission in Verification. When
-- submitted_by differs from tenant_profile_id, staff submitted it for the
-- tenant; when they match, the tenant submitted it themselves.
alter table public.smart_meter_top_up_requests
  add column if not exists submitted_by uuid references auth.users(id) on delete set null;

-- Backfill: every existing request predates the staff-assisted flow, so it
-- was necessarily a tenant self-submission.
update public.smart_meter_top_up_requests
set submitted_by = tenant_profile_id
where submitted_by is null;

alter table public.smart_meter_top_up_requests
  alter column submitted_by set not null;

create index if not exists smart_meter_top_up_submitted_by_idx
  on public.smart_meter_top_up_requests (submitted_by);

-- Extend the existing "credited records are immutable" guard to also cover
-- submitted_by, consistent with the other audit-trail columns it already
-- protects.
create or replace function public.protect_credited_smart_meter_top_up()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'credited' and old.retain_until >= current_date then
      raise exception
        'Credited electricity top-up records must be retained until %.',
        old.retain_until;
    end if;
    return old;
  end if;

  if old.status = 'credited' and (
    new.id is distinct from old.id
    or new.amount is distinct from old.amount
    or new.payment_slip_bucket is distinct from old.payment_slip_bucket
    or new.payment_slip_path is distinct from old.payment_slip_path
    or new.payment_slip_name is distinct from old.payment_slip_name
    or new.bill_month is distinct from old.bill_month
    or new.payment_date is distinct from old.payment_date
    or new.rent_bill_id is distinct from old.rent_bill_id
    or new.status is distinct from old.status
    or new.provider_reference is distinct from old.provider_reference
    or new.credit_before is distinct from old.credit_before
    or new.credit_after is distinct from old.credit_after
    or new.submitted_by is distinct from old.submitted_by
    or new.retain_until < old.retain_until
  ) then
    raise exception 'Credited electricity top-up audit records are immutable.';
  end if;

  return new;
end;
$$;
