alter table public.tenancy_renewals
  add column if not exists decision_status text not null default 'pending',
  add column if not exists decision_requested_at timestamptz,
  add column if not exists decision_recorded_at timestamptz,
  add column if not exists decision_recorded_by uuid references auth.users(id) on delete set null,
  add column if not exists decision_channel text,
  add column if not exists decision_note text;

alter table public.tenancy_renewals
  drop constraint if exists tenancy_renewals_decision_status_check;

alter table public.tenancy_renewals
  add constraint tenancy_renewals_decision_status_check
  check (decision_status in ('pending', 'requested', 'renew', 'not_renew'));

update public.tenancy_renewals as renewals
set
  decision_status = 'renew',
  decision_recorded_at = coalesce(
    agreements.signed_at,
    renewals.updated_at,
    renewals.created_at
  ),
  decision_recorded_by = coalesce(
    agreements.admin_verified_by,
    agreements.created_by,
    renewals.created_by
  ),
  decision_channel = 'signed_agreement'
from public.tenancy_agreements as agreements
where agreements.id = renewals.new_agreement_id
  and agreements.status::text in ('signed', 'renewal_signed');

create unique index if not exists tenancy_renewals_tenancy_start_unique
  on public.tenancy_renewals (tenancy_id, new_start_date)
  where new_start_date is not null;

create index if not exists tenancy_renewals_decision_status_idx
  on public.tenancy_renewals (decision_status, decision_requested_at desc);

comment on column public.tenancy_renewals.decision_status is
  'Tenant renewal decision. A renewal agreement may only be prepared after this is renew.';
