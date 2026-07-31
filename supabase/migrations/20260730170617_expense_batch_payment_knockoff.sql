alter table public.expenses
  add column if not exists payment_status text,
  add column if not exists paid_at timestamptz;

update public.expenses
set
  payment_status = case
    when status = 'reimbursed' then 'paid'
    when status = 'verified' and funding_source <> 'staff_personal' then 'paid'
    else 'unpaid'
  end,
  paid_at = case
    when status = 'reimbursed'
      then coalesce(reimbursed_at, verified_at, created_at)
    when status = 'verified' and funding_source <> 'staff_personal'
      then coalesce(verified_at, created_at)
    else null
  end
where payment_status is null;

alter table public.expenses
  alter column payment_status set default 'unpaid',
  alter column payment_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'expenses_payment_status_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_payment_status_check
      check (
        (
          payment_status = 'unpaid'
          and paid_at is null
        )
        or (
          payment_status = 'paid'
          and paid_at is not null
        )
      );
  end if;
end
$$;

create table if not exists public.expense_payment_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete restrict,
  company_id uuid references public.companies(id) on delete restrict,
  total_amount numeric(12, 2) not null check (total_amount > 0),
  payment_method text not null check (
    payment_method in (
      'company_bank',
      'company_card',
      'company_cash',
      'cheque',
      'other'
    )
  ),
  paid_on date not null,
  reference_number text,
  notes text,
  proof_bucket_name text not null default 'expense-payment-proofs',
  proof_file_path text not null unique,
  proof_file_name text,
  proof_content_type text,
  retain_until date not null
    default ((current_date + interval '7 years')::date),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.expense_payment_allocations (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null
    references public.expense_payment_batches(id) on delete restrict,
  expense_id uuid not null unique
    references public.expenses(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create index if not exists expenses_unpaid_verified_payment_idx
  on public.expenses (expense_date, id)
  where status = 'verified'
    and payment_status = 'unpaid'
    and funding_source in ('company_cash', 'company_bank');

create index if not exists expense_payment_batches_paid_on_idx
  on public.expense_payment_batches (paid_on desc, created_at desc);

create index if not exists expense_payment_batches_organization_idx
  on public.expense_payment_batches (organization_id)
  where organization_id is not null;

create index if not exists expense_payment_batches_company_idx
  on public.expense_payment_batches (company_id)
  where company_id is not null;

create index if not exists expense_payment_batches_recorded_by_idx
  on public.expense_payment_batches (recorded_by);

create index if not exists expense_payment_allocations_batch_idx
  on public.expense_payment_allocations (batch_id);

insert into storage.buckets (id, name, public)
values ('expense-payment-proofs', 'expense-payment-proofs', false)
on conflict (id) do update
set public = false;

alter table public.expense_payment_batches enable row level security;
alter table public.expense_payment_allocations enable row level security;

drop policy if exists "expense_payment_batches_select_allowed"
  on public.expense_payment_batches;
create policy "expense_payment_batches_select_allowed"
on public.expense_payment_batches
for select
to authenticated
using (
  (select public.is_platform_admin())
  or (
    company_id is not null
    and public.can_manage_company(company_id)
  )
);

drop policy if exists "expense_payment_allocations_select_allowed"
  on public.expense_payment_allocations;
create policy "expense_payment_allocations_select_allowed"
on public.expense_payment_allocations
for select
to authenticated
using (
  exists (
    select 1
    from public.expense_payment_batches batches
    where batches.id = expense_payment_allocations.batch_id
      and (
        (select public.is_platform_admin())
        or (
          batches.company_id is not null
          and public.can_manage_company(batches.company_id)
        )
      )
  )
);

revoke all on table public.expense_payment_batches from anon;
revoke all on table public.expense_payment_allocations from anon;
revoke insert, update, delete on table public.expense_payment_batches
  from authenticated;
revoke insert, update, delete on table public.expense_payment_allocations
  from authenticated;
grant select on table public.expense_payment_batches to authenticated;
grant select on table public.expense_payment_allocations to authenticated;

create or replace function public.sync_reimbursed_expense_payment_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'reimbursed' then
    new.payment_status := 'paid';
    new.paid_at := coalesce(new.reimbursed_at, new.paid_at, now());
  end if;
  return new;
end;
$$;

drop trigger if exists sync_reimbursed_expense_payment_status_trigger
  on public.expenses;
create trigger sync_reimbursed_expense_payment_status_trigger
before insert or update of status, reimbursed_at
on public.expenses
for each row
execute function public.sync_reimbursed_expense_payment_status();

create or replace function public.record_expense_payment_batch(
  target_expense_ids uuid[],
  batch_payment_method text,
  batch_paid_on date,
  batch_reference text,
  batch_notes text,
  batch_proof_bucket text,
  batch_proof_path text,
  batch_proof_file_name text,
  batch_proof_content_type text,
  batch_recorded_by uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_batch_id uuid;
  selected_count integer;
  selected_total numeric(12, 2);
  selected_organization_id uuid;
  selected_company_id uuid;
  updated_count integer;
begin
  if batch_recorded_by is null
    or batch_paid_on is null
    or batch_payment_method not in (
      'company_bank',
      'company_card',
      'company_cash',
      'cheque',
      'other'
    )
    or coalesce(cardinality(target_expense_ids), 0) = 0
    or (
      select count(distinct selected.expense_id)
      from unnest(target_expense_ids) as selected(expense_id)
    ) <> cardinality(target_expense_ids)
    or nullif(btrim(batch_proof_bucket), '') is null
    or nullif(btrim(batch_proof_path), '') is null
  then
    raise exception 'invalid_expense_payment_batch';
  end if;

  perform expenses.id
  from public.expenses expenses
  where expenses.id = any(target_expense_ids)
  order by expenses.id
  for update;

  select
    count(*),
    coalesce(sum(expenses.amount), 0),
    (array_agg(expenses.organization_id)
      filter (where expenses.organization_id is not null))[1],
    (array_agg(expenses.company_id)
      filter (where expenses.company_id is not null))[1]
  into
    selected_count,
    selected_total,
    selected_organization_id,
    selected_company_id
  from public.expenses expenses
  where expenses.id = any(target_expense_ids)
    and expenses.status = 'verified'
    and expenses.payment_status = 'unpaid'
    and expenses.funding_source in ('company_cash', 'company_bank')
    and expenses.amount > 0;

  if selected_count <> cardinality(target_expense_ids)
    or selected_total <= 0
  then
    raise exception 'expense_payment_items_changed';
  end if;

  if (
    select count(distinct expenses.organization_id)
    from public.expenses expenses
    where expenses.id = any(target_expense_ids)
      and expenses.organization_id is not null
  ) > 1
    or (
      select count(distinct expenses.company_id)
      from public.expenses expenses
      where expenses.id = any(target_expense_ids)
        and expenses.company_id is not null
    ) > 1
  then
    raise exception 'expense_payment_mixed_companies';
  end if;

  insert into public.expense_payment_batches (
    organization_id,
    company_id,
    total_amount,
    payment_method,
    paid_on,
    reference_number,
    notes,
    proof_bucket_name,
    proof_file_path,
    proof_file_name,
    proof_content_type,
    recorded_by
  )
  values (
    selected_organization_id,
    selected_company_id,
    selected_total,
    batch_payment_method,
    batch_paid_on,
    nullif(btrim(batch_reference), ''),
    nullif(btrim(batch_notes), ''),
    batch_proof_bucket,
    batch_proof_path,
    nullif(btrim(batch_proof_file_name), ''),
    nullif(btrim(batch_proof_content_type), ''),
    batch_recorded_by
  )
  returning id into new_batch_id;

  insert into public.expense_payment_allocations (
    batch_id,
    expense_id,
    amount
  )
  select
    new_batch_id,
    expenses.id,
    expenses.amount
  from public.expenses expenses
  where expenses.id = any(target_expense_ids)
  order by expenses.id;

  update public.expenses
  set
    payment_status = 'paid',
    paid_at = now(),
    updated_at = now()
  where id = any(target_expense_ids)
    and status = 'verified'
    and payment_status = 'unpaid'
    and funding_source in ('company_cash', 'company_bank');

  get diagnostics updated_count = row_count;
  if updated_count <> cardinality(target_expense_ids) then
    raise exception 'expense_payment_items_changed';
  end if;

  return new_batch_id;
end;
$$;

revoke all on function public.record_expense_payment_batch(
  uuid[],
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) from public, anon, authenticated;

grant execute on function public.record_expense_payment_batch(
  uuid[],
  text,
  date,
  text,
  text,
  text,
  text,
  text,
  text,
  uuid
) to service_role;

create or replace function public.prevent_retained_expense_payment_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  retention_date date;
begin
  if tg_table_name = 'expense_payment_batches' then
    retention_date := old.retain_until;
  elsif tg_table_name = 'expense_payment_allocations' then
    select batches.retain_until
    into retention_date
    from public.expense_payment_batches batches
    where batches.id = old.batch_id;
  elsif tg_table_name = 'expenses' then
    select batches.retain_until
    into retention_date
    from public.expense_payment_allocations allocations
    join public.expense_payment_batches batches
      on batches.id = allocations.batch_id
    where allocations.expense_id = old.id;

    if retention_date > current_date
      and tg_op = 'UPDATE'
      and old.payment_status = 'unpaid'
      and new.payment_status = 'paid'
      and new.paid_at is not null
      and (
        to_jsonb(new) - array['payment_status', 'paid_at', 'updated_at']
      ) = (
        to_jsonb(old) - array['payment_status', 'paid_at', 'updated_at']
      )
    then
      return new;
    end if;
  end if;

  if retention_date > current_date then
    raise exception 'expense_payment_retained_until_%', retention_date;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists expense_payment_batches_retain_seven_years
  on public.expense_payment_batches;
create trigger expense_payment_batches_retain_seven_years
before update or delete on public.expense_payment_batches
for each row
execute function public.prevent_retained_expense_payment_mutation();

drop trigger if exists expense_payment_allocations_retain_seven_years
  on public.expense_payment_allocations;
create trigger expense_payment_allocations_retain_seven_years
before update or delete on public.expense_payment_allocations
for each row
execute function public.prevent_retained_expense_payment_mutation();

drop trigger if exists paid_expenses_retain_seven_years
  on public.expenses;
create trigger paid_expenses_retain_seven_years
before update or delete on public.expenses
for each row
execute function public.prevent_retained_expense_payment_mutation();

revoke all on function public.sync_reimbursed_expense_payment_status()
  from public, anon, authenticated;
revoke all on function public.prevent_retained_expense_payment_mutation()
  from public, anon, authenticated;

comment on column public.expenses.payment_status is
  'Separate payment state: verification confirms the bill; payment proof settles it.';

comment on table public.expense_payment_batches is
  'One immutable bank slip, card statement, or other payment proof that settles multiple verified expense bills.';

comment on table public.expense_payment_allocations is
  'Immutable full-payment links from one expense payment batch to each settled expense bill.';

comment on column public.expense_payment_batches.retain_until is
  'Financial audit retention date, seven years from the batch payment record.';
