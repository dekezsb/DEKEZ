alter table public.claims
  add column if not exists bill_date date;

update public.claims
set bill_date = (submitted_at at time zone 'Asia/Kuala_Lumpur')::date
where bill_date is null;

alter table public.claims
  alter column bill_date set default current_date,
  alter column bill_date set not null;

create index if not exists claims_bill_date_idx
  on public.claims (bill_date desc);

alter table public.claim_attachments
  add column if not exists retain_until date;

update public.claim_attachments
set retain_until =
  ((created_at at time zone 'Asia/Kuala_Lumpur')::date + interval '7 years')::date
where retain_until is null;

alter table public.claim_attachments
  alter column retain_until
    set default ((current_date + interval '7 years')::date),
  alter column retain_until set not null;

alter table public.expense_attachments
  add column if not exists retain_until date;

update public.expense_attachments
set retain_until =
  ((created_at at time zone 'Asia/Kuala_Lumpur')::date + interval '7 years')::date
where retain_until is null;

alter table public.expense_attachments
  alter column retain_until
    set default ((current_date + interval '7 years')::date),
  alter column retain_until set not null;

create table if not exists public.staff_reimbursement_payouts (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references auth.users(id) on delete restrict,
  total_amount numeric(12, 2) not null check (total_amount > 0),
  payment_source text not null check (
    payment_source in ('company_cash', 'company_bank')
  ),
  paid_on date not null,
  reference_number text,
  notes text,
  proof_bucket_name text not null default 'reimbursement-proofs',
  proof_file_path text not null,
  proof_content_type text,
  retain_until date not null
    default ((current_date + interval '7 years')::date),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.staff_reimbursement_liabilities (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null unique references public.claims(id) on delete restrict,
  expense_id uuid not null unique references public.expenses(id) on delete restrict,
  staff_id uuid not null references auth.users(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  status text not null default 'owed' check (status in ('owed', 'paid')),
  owed_at timestamptz not null default now(),
  paid_at timestamptz,
  payout_id uuid references public.staff_reimbursement_payouts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_reimbursement_liability_paid_state_check check (
    (
      status = 'owed'
      and paid_at is null
      and payout_id is null
    )
    or (
      status = 'paid'
      and paid_at is not null
      and payout_id is not null
    )
  )
);

create index if not exists staff_reimbursement_liabilities_staff_status_idx
  on public.staff_reimbursement_liabilities (staff_id, status, owed_at);

create index if not exists staff_reimbursement_liabilities_payout_idx
  on public.staff_reimbursement_liabilities (payout_id)
  where payout_id is not null;

create index if not exists staff_reimbursement_payouts_staff_date_idx
  on public.staff_reimbursement_payouts (staff_id, paid_on desc, created_at desc);

insert into storage.buckets (id, name, public)
values ('reimbursement-proofs', 'reimbursement-proofs', false)
on conflict (id) do update
set public = false;

alter table public.staff_reimbursement_payouts enable row level security;
alter table public.staff_reimbursement_liabilities enable row level security;

drop policy if exists "staff_reimbursement_payouts_select_allowed"
  on public.staff_reimbursement_payouts;
create policy "staff_reimbursement_payouts_select_allowed"
on public.staff_reimbursement_payouts
for select
to authenticated
using (
  staff_id = (select auth.uid())
  or public.is_platform_admin()
);

drop policy if exists "staff_reimbursement_liabilities_select_allowed"
  on public.staff_reimbursement_liabilities;
create policy "staff_reimbursement_liabilities_select_allowed"
on public.staff_reimbursement_liabilities
for select
to authenticated
using (
  staff_id = (select auth.uid())
  or public.is_platform_admin()
);

revoke all on table public.staff_reimbursement_payouts from anon;
revoke all on table public.staff_reimbursement_liabilities from anon;
revoke insert, update, delete on table public.staff_reimbursement_payouts
  from authenticated;
revoke insert, update, delete on table public.staff_reimbursement_liabilities
  from authenticated;
grant select on table public.staff_reimbursement_payouts to authenticated;
grant select on table public.staff_reimbursement_liabilities to authenticated;

insert into public.staff_reimbursement_liabilities (
  claim_id,
  expense_id,
  staff_id,
  amount,
  status,
  owed_at
)
select
  claims.id,
  expenses.id,
  claims.submitted_by,
  expenses.amount,
  'owed',
  coalesce(claims.reviewed_at, expenses.verified_at, now())
from public.claims
join public.expenses
  on expenses.claim_id = claims.id
where claims.funding_source = 'staff_personal'
  and claims.status = 'approved'
  and expenses.funding_source = 'staff_personal'
  and expenses.status = 'verified'
on conflict (claim_id) do nothing;

create or replace function public.record_staff_reimbursement_payout(
  target_staff_id uuid,
  liability_ids uuid[],
  payout_source text,
  payout_date date,
  payout_reference text,
  payout_notes text,
  payout_proof_bucket text,
  payout_proof_path text,
  payout_proof_content_type text,
  payout_recorded_by uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_payout_id uuid;
  selected_count integer;
  selected_total numeric(12, 2);
begin
  if target_staff_id is null
    or payout_recorded_by is null
    or payout_date is null
    or payout_source not in ('company_cash', 'company_bank')
    or coalesce(cardinality(liability_ids), 0) = 0
    or nullif(btrim(payout_proof_bucket), '') is null
    or nullif(btrim(payout_proof_path), '') is null
  then
    raise exception 'invalid_reimbursement_payout';
  end if;

  perform 1
  from public.staff_reimbursement_liabilities
  where id = any(liability_ids)
  for update;

  select count(*), coalesce(sum(amount), 0)
  into selected_count, selected_total
  from public.staff_reimbursement_liabilities
  where id = any(liability_ids)
    and staff_id = target_staff_id
    and status = 'owed'
    and payout_id is null;

  if selected_count <> cardinality(liability_ids)
    or selected_total <= 0
  then
    raise exception 'reimbursement_items_changed';
  end if;

  insert into public.staff_reimbursement_payouts (
    staff_id,
    total_amount,
    payment_source,
    paid_on,
    reference_number,
    notes,
    proof_bucket_name,
    proof_file_path,
    proof_content_type,
    recorded_by
  )
  values (
    target_staff_id,
    selected_total,
    payout_source,
    payout_date,
    nullif(btrim(payout_reference), ''),
    nullif(btrim(payout_notes), ''),
    payout_proof_bucket,
    payout_proof_path,
    nullif(btrim(payout_proof_content_type), ''),
    payout_recorded_by
  )
  returning id into new_payout_id;

  update public.staff_reimbursement_liabilities
  set
    status = 'paid',
    payout_id = new_payout_id,
    paid_at = now(),
    updated_at = now()
  where id = any(liability_ids)
    and staff_id = target_staff_id
    and status = 'owed'
    and payout_id is null;

  if not found then
    raise exception 'reimbursement_items_changed';
  end if;

  update public.expenses
  set
    status = 'reimbursed',
    reimbursement_source = payout_source,
    reimbursed_at = now(),
    updated_at = now()
  where id in (
    select expense_id
    from public.staff_reimbursement_liabilities
    where payout_id = new_payout_id
  );

  update public.claims
  set
    status = 'paid',
    updated_at = now()
  where id in (
    select claim_id
    from public.staff_reimbursement_liabilities
    where payout_id = new_payout_id
  );

  return new_payout_id;
end;
$$;

revoke all on function public.record_staff_reimbursement_payout(
  uuid,
  uuid[],
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.record_staff_reimbursement_payout(
  uuid,
  uuid[],
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  uuid
) to service_role;

comment on table public.staff_reimbursement_liabilities is
  'One immutable staff repayment liability for each verified staff-funded claim.';

comment on table public.staff_reimbursement_payouts is
  'Audited batch payouts that settle one or more staff reimbursement liabilities.';

create or replace function public.prevent_early_financial_document_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.retain_until > current_date then
    raise exception 'document_retained_until_%', old.retain_until;
  end if;
  return old;
end;
$$;

drop trigger if exists claim_attachments_retain_seven_years
  on public.claim_attachments;
create trigger claim_attachments_retain_seven_years
before delete on public.claim_attachments
for each row
execute function public.prevent_early_financial_document_delete();

drop trigger if exists expense_attachments_retain_seven_years
  on public.expense_attachments;
create trigger expense_attachments_retain_seven_years
before delete on public.expense_attachments
for each row
execute function public.prevent_early_financial_document_delete();

revoke all on function public.prevent_early_financial_document_delete()
  from public, anon, authenticated;

comment on column public.claim_attachments.retain_until is
  'Financial audit retention date. The portal blocks deletion before this date.';

comment on column public.expense_attachments.retain_until is
  'Financial audit retention date. The portal blocks deletion before this date.';

comment on column public.staff_reimbursement_payouts.retain_until is
  'Payout proof retention date, seven years from the recorded payout.';
