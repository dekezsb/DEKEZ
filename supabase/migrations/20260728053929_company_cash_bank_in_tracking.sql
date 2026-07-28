alter table public.expenses
  add column if not exists funding_source text,
  add column if not exists reimbursement_source text,
  add column if not exists reimbursed_at timestamptz;

update public.expenses
set funding_source = case
  when payment_method = 'cash' then 'company_cash'
  else 'company_bank'
end
where funding_source is null;

alter table public.expenses
  alter column funding_source set default 'company_cash',
  alter column funding_source set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'expenses_funding_source_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_funding_source_check
      check (funding_source in ('company_cash', 'company_bank', 'staff_personal'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'expenses_reimbursement_source_check'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_reimbursement_source_check
      check (
        reimbursement_source is null
        or reimbursement_source in ('company_cash', 'company_bank')
      );
  end if;
end
$$;

create table if not exists public.cash_bank_ins (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  banked_on date not null default current_date,
  bank_name text,
  reference_number text,
  notes text,
  status text not null default 'completed' check (
    status in ('completed', 'cancelled')
  ),
  recorded_by uuid not null references auth.users(id) on delete restrict,
  cancelled_by uuid references auth.users(id) on delete restrict,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cash_bank_ins_company_date_idx
  on public.cash_bank_ins (company_id, banked_on desc);

create index if not exists cash_bank_ins_status_idx
  on public.cash_bank_ins (status);

create unique index if not exists cash_bank_ins_company_reference_unique
  on public.cash_bank_ins (company_id, lower(reference_number))
  where status = 'completed'
    and nullif(btrim(reference_number), '') is not null;

alter table public.cash_bank_ins enable row level security;

drop policy if exists "cash_bank_ins_select_allowed" on public.cash_bank_ins;
create policy "cash_bank_ins_select_allowed"
on public.cash_bank_ins
for select
to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_company(company_id)
);

drop policy if exists "cash_bank_ins_insert_admin" on public.cash_bank_ins;
create policy "cash_bank_ins_insert_admin"
on public.cash_bank_ins
for insert
to authenticated
with check (
  public.is_platform_admin()
  and recorded_by = (select auth.uid())
);

drop policy if exists "cash_bank_ins_update_admin" on public.cash_bank_ins;
create policy "cash_bank_ins_update_admin"
on public.cash_bank_ins
for update
to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

revoke all on table public.cash_bank_ins from anon;
revoke delete on table public.cash_bank_ins from authenticated;
grant select, insert, update on table public.cash_bank_ins to authenticated;

grant select, insert, update on table public.expenses to authenticated;
