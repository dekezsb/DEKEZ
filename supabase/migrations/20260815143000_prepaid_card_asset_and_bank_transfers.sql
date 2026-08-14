update public.accounting_accounts accounts
set
  code = '1020',
  account_type = 'asset',
  report_group = 'current_asset',
  normal_balance = 'debit',
  description = 'Public Bank prepaid top-up card balance',
  sort_order = 1020,
  updated_at = now()
from public.bank_accounts bank_accounts
where bank_accounts.accounting_account_id = accounts.id
  and regexp_replace(coalesce(bank_accounts.account_number, ''), '[^0-9]', '', 'g') = '4484358200608627'
  and not exists (
    select 1
    from public.accounting_accounts conflict_account
    where conflict_account.company_id = accounts.company_id
      and conflict_account.code = '1020'
      and conflict_account.id <> accounts.id
  );

create table if not exists public.bank_account_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  from_bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  to_bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  from_statement_line_id uuid not null references public.bank_statement_lines(id) on delete restrict,
  to_statement_line_id uuid not null references public.bank_statement_lines(id) on delete restrict,
  transfer_date date not null,
  amount numeric(14, 2) not null check (amount > 0),
  description text not null,
  reference_number text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  check (from_bank_account_id <> to_bank_account_id),
  check (from_statement_line_id <> to_statement_line_id),
  unique (from_statement_line_id, to_statement_line_id)
);

create index if not exists bank_account_transfers_company_date_idx
  on public.bank_account_transfers (company_id, transfer_date desc);
create index if not exists bank_account_transfers_from_account_idx
  on public.bank_account_transfers (from_bank_account_id, transfer_date desc);
create index if not exists bank_account_transfers_to_account_idx
  on public.bank_account_transfers (to_bank_account_id, transfer_date desc);

alter table public.bank_account_transfers enable row level security;

drop policy if exists "bank_account_transfers_select_allowed" on public.bank_account_transfers;
create policy "bank_account_transfers_select_allowed"
on public.bank_account_transfers for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

revoke all on table public.bank_account_transfers from anon;
grant select on table public.bank_account_transfers to authenticated;
revoke insert, update, delete on table public.bank_account_transfers from authenticated;

alter table public.bank_reconciliation_matches
  drop constraint if exists bank_reconciliation_matches_source_type_check;
alter table public.bank_reconciliation_matches
  add constraint bank_reconciliation_matches_source_type_check check (
    source_type in (
      'payment',
      'rent_bill',
      'expense_payment_batch',
      'staff_reimbursement_payout',
      'cash_bank_in',
      'expense',
      'manual_bank_transaction',
      'bank_account_transfer'
    )
  );

create or replace function public.match_bank_account_transfer(
  target_company_id uuid,
  target_line_id uuid,
  target_counterpart_line_id uuid,
  target_created_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  first_line public.bank_statement_lines%rowtype;
  second_line public.bank_statement_lines%rowtype;
  outgoing_line public.bank_statement_lines%rowtype;
  incoming_line public.bank_statement_lines%rowtype;
  outgoing_statement public.bank_statement_imports%rowtype;
  incoming_statement public.bank_statement_imports%rowtype;
  outgoing_account public.bank_accounts%rowtype;
  incoming_account public.bank_accounts%rowtype;
  transfer_id uuid := gen_random_uuid();
begin
  if target_company_id is null
    or target_line_id is null
    or target_counterpart_line_id is null
    or target_created_by is null
    or target_line_id = target_counterpart_line_id
  then
    raise exception 'bank_transfer_details_required';
  end if;

  if not exists (
    select 1
    from public.profiles profiles
    where profiles.id = target_created_by
      and profiles.role::text in ('super_admin', 'admin')
  ) and not exists (
    select 1
    from public.company_users company_users
    where company_users.company_id = target_company_id
      and coalesce(company_users.user_id, company_users.profile_id) = target_created_by
      and company_users.status::text = 'active'
      and company_users.role::text in ('owner', 'admin', 'admin_team')
  ) then
    raise exception 'bank_transfer_not_allowed';
  end if;

  select * into first_line
  from public.bank_statement_lines
  where id = target_line_id
  for update;
  select * into second_line
  from public.bank_statement_lines
  where id = target_counterpart_line_id
  for update;

  if first_line.id is null or second_line.id is null
    or first_line.status <> 'unmatched' or second_line.status <> 'unmatched'
    or first_line.bank_account_id = second_line.bank_account_id
    or sign(first_line.amount) = sign(second_line.amount)
    or abs(abs(first_line.amount) - abs(second_line.amount)) > 0.005
  then
    raise exception 'bank_transfer_lines_invalid';
  end if;

  if first_line.amount < 0 then
    outgoing_line := first_line;
    incoming_line := second_line;
  else
    outgoing_line := second_line;
    incoming_line := first_line;
  end if;

  select * into outgoing_statement
  from public.bank_statement_imports
  where id = outgoing_line.statement_import_id;
  select * into incoming_statement
  from public.bank_statement_imports
  where id = incoming_line.statement_import_id;
  select * into outgoing_account
  from public.bank_accounts
  where id = outgoing_line.bank_account_id;
  select * into incoming_account
  from public.bank_accounts
  where id = incoming_line.bank_account_id;

  if outgoing_statement.status <> 'in_progress'
    or incoming_statement.status <> 'in_progress'
    or outgoing_statement.company_id <> target_company_id
    or incoming_statement.company_id <> target_company_id
    or outgoing_account.company_id <> target_company_id
    or incoming_account.company_id <> target_company_id
  then
    raise exception 'bank_transfer_company_or_statement_invalid';
  end if;

  insert into public.bank_account_transfers (
    id, company_id, from_bank_account_id, to_bank_account_id,
    from_statement_line_id, to_statement_line_id, transfer_date,
    amount, description, reference_number, created_by
  ) values (
    transfer_id, target_company_id, outgoing_line.bank_account_id, incoming_line.bank_account_id,
    outgoing_line.id, incoming_line.id, greatest(outgoing_line.transaction_date, incoming_line.transaction_date),
    abs(outgoing_line.amount),
    'Transfer between own accounts: ' || outgoing_account.name || ' to ' || incoming_account.name,
    coalesce(nullif(btrim(outgoing_line.reference_number), ''), nullif(btrim(incoming_line.reference_number), '')),
    target_created_by
  );

  insert into public.bank_reconciliation_matches (
    statement_line_id, source_type, source_id, matched_amount, match_method, created_by
  ) values
    (outgoing_line.id, 'bank_account_transfer', transfer_id, outgoing_line.amount, 'manual', target_created_by),
    (incoming_line.id, 'bank_account_transfer', transfer_id, incoming_line.amount, 'manual', target_created_by);

  update public.bank_statement_lines
  set status = 'matched', updated_at = now()
  where id in (outgoing_line.id, incoming_line.id);

  insert into public.accounting_audit_logs (
    company_id, entity_type, entity_id, action, after_data, reason, performed_by
  ) values (
    target_company_id,
    'bank_account_transfer',
    transfer_id,
    'match_own_account_transfer',
    jsonb_build_object(
      'from_bank_account_id', outgoing_line.bank_account_id,
      'to_bank_account_id', incoming_line.bank_account_id,
      'from_statement_line_id', outgoing_line.id,
      'to_statement_line_id', incoming_line.id,
      'amount', abs(outgoing_line.amount)
    ),
    'Linked the bank debit and prepaid-card credit as one own-account transfer.',
    target_created_by
  );

  return transfer_id;
end;
$$;

revoke all on function public.match_bank_account_transfer(uuid, uuid, uuid, uuid) from public;
revoke all on function public.match_bank_account_transfer(uuid, uuid, uuid, uuid) from anon;
revoke all on function public.match_bank_account_transfer(uuid, uuid, uuid, uuid) from authenticated;
grant execute on function public.match_bank_account_transfer(uuid, uuid, uuid, uuid) to service_role;

comment on table public.bank_account_transfers is
  'Links the outgoing and incoming statement lines for transfers between DEKEZ-owned bank and prepaid-card accounts.';
comment on function public.match_bank_account_transfer(uuid, uuid, uuid, uuid) is
  'Atomically matches equal and opposite statement lines from two DEKEZ-owned accounts without recording income or expense.';
