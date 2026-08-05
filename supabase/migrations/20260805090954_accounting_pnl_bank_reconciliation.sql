-- DEKEZ accounting foundation.
-- Operational modules remain the source of truth. This layer adds a chart of
-- accounts, audited adjustments, bank statements and many-to-many matching.

create table if not exists public.accounting_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  code text not null,
  name text not null,
  account_type text not null check (
    account_type in ('asset', 'liability', 'equity', 'income', 'expense')
  ),
  report_group text not null check (
    report_group in (
      'current_asset',
      'non_current_asset',
      'current_liability',
      'non_current_liability',
      'equity',
      'revenue',
      'cost_of_sales',
      'operating_expense',
      'other_income',
      'other_expense'
    )
  ),
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  system_key text,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code),
  unique (company_id, system_key)
);

create table if not exists public.accounting_category_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  source_type text not null check (
    source_type in ('rent', 'deposit', 'invoice_line_item', 'expense_category', 'bank_adjustment')
  ),
  source_key text not null,
  account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_type, source_key)
);

create table if not exists public.accounting_journal_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  entry_date date not null,
  entry_number text not null,
  source_type text not null,
  source_id uuid,
  reference_number text,
  description text not null,
  status text not null default 'posted' check (status in ('draft', 'posted', 'reversed')),
  reversed_entry_id uuid references public.accounting_journal_entries(id) on delete restrict,
  posted_at timestamptz,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, entry_number)
);

create table if not exists public.accounting_journal_lines (
  id uuid primary key default gen_random_uuid(),
  journal_entry_id uuid not null
    references public.accounting_journal_entries(id) on delete restrict,
  account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  tenant_id uuid references auth.users(id) on delete restrict,
  description text,
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  created_at timestamptz not null default now(),
  check (
    (debit > 0 and credit = 0)
    or (credit > 0 and debit = 0)
  )
);

create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status text not null default 'open' check (status in ('open', 'locked')),
  locked_at timestamptz,
  locked_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  unique (company_id, period_start, period_end)
);

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  accounting_account_id uuid not null
    references public.accounting_accounts(id) on delete restrict,
  name text not null,
  bank_name text not null,
  account_number_last4 text,
  currency text not null default 'MYR',
  opening_balance numeric(14, 2) not null default 0,
  opening_balance_date date,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, accounting_account_id)
);

create table if not exists public.bank_statement_imports (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  company_id uuid not null references public.companies(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  statement_date date not null,
  opening_balance numeric(14, 2) not null,
  closing_balance numeric(14, 2) not null,
  source_format text not null check (source_format in ('csv', 'pdf', 'manual')),
  original_bucket_name text not null default 'accounting-documents',
  original_file_path text,
  original_file_name text,
  status text not null default 'in_progress' check (
    status in ('in_progress', 'reconciled', 'void')
  ),
  retain_until date not null default ((current_date + interval '7 years')::date),
  created_by uuid not null references auth.users(id) on delete restrict,
  reconciled_by uuid references auth.users(id) on delete restrict,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table if not exists public.bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  statement_import_id uuid not null
    references public.bank_statement_imports(id) on delete restrict,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  transaction_date date not null,
  value_date date,
  description text not null,
  reference_number text,
  amount numeric(14, 2) not null check (amount <> 0),
  external_hash text not null,
  status text not null default 'unmatched' check (
    status in ('unmatched', 'matched', 'adjusted', 'ignored')
  ),
  ignored_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (statement_import_id, external_hash)
);

create table if not exists public.bank_manual_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  bank_account_id uuid not null references public.bank_accounts(id) on delete restrict,
  offset_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  transaction_date date not null,
  amount numeric(14, 2) not null check (amount <> 0),
  description text not null,
  reference_number text,
  attachment_bucket_name text,
  attachment_file_path text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.bank_reconciliation_matches (
  id uuid primary key default gen_random_uuid(),
  statement_line_id uuid not null
    references public.bank_statement_lines(id) on delete restrict,
  source_type text not null check (
    source_type in (
      'payment',
      'expense_payment_batch',
      'staff_reimbursement_payout',
      'cash_bank_in',
      'expense',
      'manual_bank_transaction'
    )
  ),
  source_id uuid not null,
  matched_amount numeric(14, 2) not null check (matched_amount <> 0),
  match_method text not null default 'manual' check (
    match_method in ('automatic', 'manual', 'split', 'merge', 'adjustment')
  ),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (statement_line_id, source_type, source_id)
);

create table if not exists public.accounting_audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  reason text,
  performed_by uuid references auth.users(id) on delete restrict,
  performed_at timestamptz not null default now()
);

create index if not exists accounting_accounts_company_type_idx
  on public.accounting_accounts (company_id, account_type, sort_order, code);
create index if not exists accounting_category_mappings_account_idx
  on public.accounting_category_mappings (account_id);
create index if not exists accounting_journal_entries_company_date_idx
  on public.accounting_journal_entries (company_id, entry_date desc, created_at desc);
create index if not exists accounting_journal_entries_source_idx
  on public.accounting_journal_entries (source_type, source_id)
  where source_id is not null;
create index if not exists accounting_journal_lines_entry_idx
  on public.accounting_journal_lines (journal_entry_id);
create index if not exists accounting_journal_lines_account_idx
  on public.accounting_journal_lines (account_id, property_id);
create index if not exists bank_accounts_company_idx
  on public.bank_accounts (company_id, is_active, name);
create index if not exists bank_statement_imports_account_period_idx
  on public.bank_statement_imports (bank_account_id, period_end desc);
create index if not exists bank_statement_lines_import_status_idx
  on public.bank_statement_lines (statement_import_id, status, transaction_date, id);
create index if not exists bank_statement_lines_account_date_amount_idx
  on public.bank_statement_lines (bank_account_id, transaction_date, amount);
create index if not exists bank_reconciliation_matches_line_idx
  on public.bank_reconciliation_matches (statement_line_id);
create index if not exists bank_reconciliation_matches_source_idx
  on public.bank_reconciliation_matches (source_type, source_id);
create index if not exists bank_manual_transactions_account_date_idx
  on public.bank_manual_transactions (bank_account_id, transaction_date desc);
create index if not exists accounting_audit_logs_entity_idx
  on public.accounting_audit_logs (company_id, entity_type, entity_id, performed_at desc);

create or replace function public.record_bank_tenant_payment_and_match(
  target_statement_line_id uuid,
  target_rent_bill_id uuid,
  rental_allocation numeric,
  deposit_allocation numeric,
  other_allocation numeric,
  other_category text,
  other_description text,
  actor_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_line public.bank_statement_lines%rowtype;
  target_import public.bank_statement_imports%rowtype;
  target_bill public.rent_bills%rowtype;
  target_company_id uuid;
  tenancy_deposit numeric(14, 2) := 0;
  existing_deposit_paid numeric(14, 2) := 0;
  existing_line_total numeric(14, 2) := 0;
  existing_match_total numeric(14, 2) := 0;
  requested_total numeric(14, 2) := 0;
  rent_outstanding numeric(14, 2) := 0;
  deposit_outstanding numeric(14, 2) := 0;
  rent_applied numeric(14, 2) := 0;
  deposit_applied numeric(14, 2) := 0;
  credit_applied numeric(14, 2) := 0;
  new_bill_paid numeric(14, 2) := 0;
  new_bill_total numeric(14, 2) := 0;
  new_deposit_paid numeric(14, 2) := 0;
  new_bill_status public.bill_status;
  payment_id uuid;
  payment_ids uuid[] := array[]::uuid[];
  payment_reference text;
begin
  if actor_id is null or target_statement_line_id is null or target_rent_bill_id is null then
    raise exception 'bank_payment_missing_details';
  end if;

  rental_allocation := coalesce(rental_allocation, 0);
  deposit_allocation := coalesce(deposit_allocation, 0);
  other_allocation := coalesce(other_allocation, 0);
  if rental_allocation < 0 or deposit_allocation < 0 or other_allocation < 0 then
    raise exception 'bank_payment_negative_allocation';
  end if;
  requested_total := rental_allocation + deposit_allocation + other_allocation;
  if requested_total <= 0 then
    raise exception 'bank_payment_empty_allocation';
  end if;
  if other_allocation > 0 and (
    other_category not in (
      'key_lock', 'electricity', 'water', 'access_card', 'damage',
      'cleaning', 'furniture', 'top_up_utilities', 'other'
    ) or nullif(btrim(other_description), '') is null
  ) then
    raise exception 'bank_payment_other_details_required';
  end if;

  select * into target_line
  from public.bank_statement_lines
  where id = target_statement_line_id
  for update;
  if not found or target_line.amount <= 0 or target_line.status = 'ignored' then
    raise exception 'bank_payment_invalid_statement_line';
  end if;

  select * into target_import
  from public.bank_statement_imports
  where id = target_line.statement_import_id;
  if target_import.status <> 'in_progress' then
    raise exception 'bank_reconciliation_is_closed';
  end if;

  select * into target_bill
  from public.rent_bills
  where id = target_rent_bill_id
  for update;
  if not found or target_bill.status in ('cancelled', 'waived') or target_bill.removed_at is not null then
    raise exception 'bank_payment_invalid_invoice';
  end if;

  select properties.company_id into target_company_id
  from public.properties
  where properties.id = target_bill.property_id;
  if target_company_id is null or target_company_id <> target_import.company_id then
    raise exception 'bank_payment_company_mismatch';
  end if;

  select coalesce(sum(matches.matched_amount), 0)
  into existing_match_total
  from public.bank_reconciliation_matches matches
  where matches.statement_line_id = target_line.id;
  if abs((target_line.amount - existing_match_total) - requested_total) > 0.005 then
    raise exception 'bank_payment_allocation_must_equal_unmatched_amount';
  end if;

  select coalesce(sum(items.amount), 0)
  into existing_line_total
  from public.rental_invoice_line_items items
  where items.rent_bill_id = target_bill.id;

  select coalesce(tenancies.deposit, 0)
  into tenancy_deposit
  from public.tenancies
  where tenancies.id = target_bill.tenancy_id;

  select coalesce(sum(payment.amount), 0)
  into existing_deposit_paid
  from public.payments payment
  where payment.tenancy_id = target_bill.tenancy_id
    and payment.category = 'deposit'
    and payment.status = 'confirmed'
    and payment.reversed_at is null;

  rent_outstanding := greatest(
    coalesce(target_bill.amount, 0) + existing_line_total - coalesce(target_bill.paid_amount, 0),
    0
  );
  deposit_outstanding := greatest(
    greatest(coalesce(target_bill.deposit_amount, 0), tenancy_deposit) - existing_deposit_paid,
    0
  );
  rent_applied := least(rental_allocation, rent_outstanding);
  deposit_applied := least(deposit_allocation, deposit_outstanding);
  credit_applied := greatest(rental_allocation - rent_applied, 0)
    + greatest(deposit_allocation - deposit_applied, 0);
  payment_reference := coalesce(
    nullif(btrim(target_line.reference_number), ''),
    'BANK-' || left(target_line.id::text, 8)
  );

  if other_allocation > 0 then
    insert into public.rental_invoice_line_items (
      rent_bill_id, category, description, amount, created_by, updated_at
    ) values (
      target_bill.id, other_category, btrim(other_description), other_allocation,
      actor_id, now()
    );
  end if;

  if rent_applied > 0 then
    insert into public.payments (
      company_id, organization_id, tenant_id, tenancy_id, property_id,
      unit_id, room_id, rent_bill_id, category, amount, payment_date,
      payment_method, reference_number, notes, status, recorded_by,
      verified_by, verified_at
    ) values (
      target_company_id, target_bill.organization_id, target_bill.tenant_id,
      target_bill.tenancy_id, target_bill.property_id, target_bill.unit_id,
      target_bill.room_id, target_bill.id, 'monthly_rent', rent_applied,
      target_line.transaction_date, 'bank_transfer', payment_reference,
      'Created and matched from bank reconciliation', 'confirmed', actor_id,
      actor_id, now()
    ) returning id into payment_id;
    payment_ids := array_append(payment_ids, payment_id);
    insert into public.bank_reconciliation_matches (
      statement_line_id, source_type, source_id, matched_amount,
      match_method, created_by
    ) values (
      target_line.id, 'payment', payment_id, rent_applied, 'manual', actor_id
    );
  end if;

  if deposit_applied > 0 then
    insert into public.payments (
      company_id, organization_id, tenant_id, tenancy_id, property_id,
      unit_id, room_id, rent_bill_id, category, amount, payment_date,
      payment_method, reference_number, notes, status, recorded_by,
      verified_by, verified_at
    ) values (
      target_company_id, target_bill.organization_id, target_bill.tenant_id,
      target_bill.tenancy_id, target_bill.property_id, target_bill.unit_id,
      target_bill.room_id, target_bill.id, 'deposit', deposit_applied,
      target_line.transaction_date, 'bank_transfer', payment_reference,
      'Created and matched from bank reconciliation', 'confirmed', actor_id,
      actor_id, now()
    ) returning id into payment_id;
    payment_ids := array_append(payment_ids, payment_id);
    insert into public.bank_reconciliation_matches (
      statement_line_id, source_type, source_id, matched_amount,
      match_method, created_by
    ) values (
      target_line.id, 'payment', payment_id, deposit_applied, 'manual', actor_id
    );
  end if;

  if other_allocation > 0 then
    insert into public.payments (
      company_id, organization_id, tenant_id, tenancy_id, property_id,
      unit_id, room_id, rent_bill_id, category, amount, payment_date,
      payment_method, reference_number, notes, status, recorded_by,
      verified_by, verified_at
    ) values (
      target_company_id, target_bill.organization_id, target_bill.tenant_id,
      target_bill.tenancy_id, target_bill.property_id, target_bill.unit_id,
      target_bill.room_id, target_bill.id, other_category, other_allocation,
      target_line.transaction_date, 'bank_transfer', payment_reference,
      btrim(other_description), 'confirmed', actor_id, actor_id, now()
    ) returning id into payment_id;
    payment_ids := array_append(payment_ids, payment_id);
    insert into public.bank_reconciliation_matches (
      statement_line_id, source_type, source_id, matched_amount,
      match_method, created_by
    ) values (
      target_line.id, 'payment', payment_id, other_allocation, 'manual', actor_id
    );
  end if;

  if credit_applied > 0 then
    insert into public.payments (
      company_id, organization_id, tenant_id, tenancy_id, property_id,
      unit_id, room_id, rent_bill_id, category, amount, payment_date,
      payment_method, reference_number, notes, status, recorded_by,
      verified_by, verified_at
    ) values (
      target_company_id, target_bill.organization_id, target_bill.tenant_id,
      target_bill.tenancy_id, target_bill.property_id, target_bill.unit_id,
      target_bill.room_id, target_bill.id, 'payment_credit', credit_applied,
      target_line.transaction_date, 'bank_transfer', payment_reference,
      'Tenant overpayment retained as unapplied credit', 'confirmed', actor_id,
      actor_id, now()
    ) returning id into payment_id;
    payment_ids := array_append(payment_ids, payment_id);
    insert into public.bank_reconciliation_matches (
      statement_line_id, source_type, source_id, matched_amount,
      match_method, created_by
    ) values (
      target_line.id, 'payment', payment_id, credit_applied, 'manual', actor_id
    );
  end if;

  new_bill_paid := coalesce(target_bill.paid_amount, 0) + rent_applied + other_allocation;
  new_bill_total := coalesce(target_bill.amount, 0) + existing_line_total + other_allocation;
  new_deposit_paid := existing_deposit_paid + deposit_applied;
  new_bill_status := case
    when new_bill_paid + new_deposit_paid >=
      new_bill_total + greatest(coalesce(target_bill.deposit_amount, 0), tenancy_deposit)
      then 'paid'
    else 'partially_paid'
  end;

  update public.rent_bills
  set paid_amount = new_bill_paid, status = new_bill_status, updated_at = now()
  where id = target_bill.id;

  update public.bank_statement_lines
  set status = 'matched', updated_at = now()
  where id = target_line.id;

  insert into public.rent_bill_audit_logs (
    bill_id, action, performed_by, old_status, new_status,
    old_paid_amount, new_paid_amount, reason
  ) values (
    target_bill.id, 'bank_reconciliation_create_and_match', actor_id,
    target_bill.status, new_bill_status, target_bill.paid_amount,
    new_bill_paid, 'Tenant forgot payment proof; bank statement used as evidence.'
  );

  insert into public.accounting_audit_logs (
    company_id, entity_type, entity_id, action, after_data, reason, performed_by
  ) values (
    target_company_id, 'bank_statement_line', target_line.id,
    'create_tenant_payment_and_match',
    jsonb_build_object(
      'rent_bill_id', target_bill.id,
      'payment_ids', to_jsonb(payment_ids),
      'rent', rent_applied,
      'deposit', deposit_applied,
      'other', other_allocation,
      'credit', credit_applied
    ),
    'Bank statement is retained as payment evidence.', actor_id
  );

  return jsonb_build_object(
    'payment_ids', to_jsonb(payment_ids),
    'rent_bill_id', target_bill.id,
    'status', new_bill_status
  );
end;
$$;

revoke all on function public.record_bank_tenant_payment_and_match(
  uuid, uuid, numeric, numeric, numeric, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.record_bank_tenant_payment_and_match(
  uuid, uuid, numeric, numeric, numeric, text, text, uuid
) to service_role;

insert into public.accounting_accounts (
  company_id, code, name, account_type, report_group, normal_balance,
  system_key, description, is_system, sort_order
)
select companies.id, seed.code, seed.name, seed.account_type, seed.report_group,
  seed.normal_balance, seed.system_key, seed.description, true, seed.sort_order
from public.companies
cross join (
  values
    ('1000', 'Cash on Hand', 'asset', 'current_asset', 'debit', 'cash_on_hand', 'Company cash and petty cash.', 1000),
    ('1010', 'Company Bank', 'asset', 'current_asset', 'debit', 'company_bank', 'Default company bank control account.', 1010),
    ('1100', 'Rental Receivables', 'asset', 'current_asset', 'debit', 'rental_receivable', 'Rent invoiced but not yet settled.', 1100),
    ('1110', 'Deposit Receivables', 'asset', 'current_asset', 'debit', 'deposit_receivable', 'Tenant deposits billed but not yet received.', 1110),
    ('1190', 'Other Tenant Receivables', 'asset', 'current_asset', 'debit', 'other_receivable', 'Utilities and other tenant charges awaiting payment.', 1190),
    ('2000', 'Accounts Payable', 'liability', 'current_liability', 'credit', 'accounts_payable', 'Verified supplier bills awaiting payment.', 2000),
    ('2100', 'Staff Reimbursement Payable', 'liability', 'current_liability', 'credit', 'staff_reimbursement_payable', 'Verified staff-funded bills awaiting reimbursement.', 2100),
    ('2200', 'Tenant Security Deposits', 'liability', 'current_liability', 'credit', 'tenant_security_deposits', 'Refundable tenant deposits held by the company.', 2200),
    ('2300', 'Tenant Credits and Overpayments', 'liability', 'current_liability', 'credit', 'tenant_credits', 'Unapplied tenant receipts and overpayments.', 2300),
    ('3000', 'Retained Earnings', 'equity', 'equity', 'credit', 'retained_earnings', 'Accumulated profit or loss.', 3000),
    ('4000', 'Rental Income', 'income', 'revenue', 'credit', 'rental_income', 'Accrued monthly room rental.', 4000),
    ('4100', 'Top Up Utilities Income', 'income', 'revenue', 'credit', 'top_up_utilities_income', 'Verified smart-meter top-up income.', 4100),
    ('4110', 'Electricity Charges Income', 'income', 'revenue', 'credit', 'electricity_income', 'Electricity and meter charges billed to tenants.', 4110),
    ('4190', 'Other Tenant Charges Income', 'income', 'revenue', 'credit', 'other_tenant_income', 'Furniture, keys and other tenant charges.', 4190),
    ('4900', 'Interest and Other Income', 'income', 'other_income', 'credit', 'other_income', 'Bank interest and non-operating income.', 4900),
    ('5000', 'Utilities Expense', 'expense', 'operating_expense', 'debit', 'utilities_expense', 'Company water, electricity and utilities.', 5000),
    ('5100', 'Repairs and Maintenance', 'expense', 'operating_expense', 'debit', 'repairs_maintenance', 'Repairs, maintenance labour and materials.', 5100),
    ('5200', 'Cleaning Expense', 'expense', 'operating_expense', 'debit', 'cleaning_expense', 'Cleaning and housekeeping costs.', 5200),
    ('5300', 'Staff Costs', 'expense', 'operating_expense', 'debit', 'staff_costs', 'Salary, allowance and staff-related costs.', 5300),
    ('5400', 'Professional Fees', 'expense', 'operating_expense', 'debit', 'professional_fees', 'Accounting, legal and professional fees.', 5400),
    ('5500', 'Bank Charges', 'expense', 'operating_expense', 'debit', 'bank_charges', 'Bank fees and payment charges.', 5500),
    ('5600', 'Office and Administration', 'expense', 'operating_expense', 'debit', 'office_admin', 'Office and administrative expenses.', 5600),
    ('5900', 'Other Operating Expenses', 'expense', 'operating_expense', 'debit', 'other_operating_expense', 'Other company operating costs.', 5900)
) as seed(
  code, name, account_type, report_group, normal_balance,
  system_key, description, sort_order
)
on conflict (company_id, code) do nothing;

insert into public.accounting_category_mappings (
  company_id, source_type, source_key, account_id
)
select companies.id, mapping.source_type, mapping.source_key, accounts.id
from public.companies
cross join (
  values
    ('rent', 'monthly_rent', 'rental_income'),
    ('deposit', 'deposit', 'tenant_security_deposits'),
    ('invoice_line_item', 'top_up_utilities', 'top_up_utilities_income'),
    ('invoice_line_item', 'electricity', 'electricity_income'),
    ('invoice_line_item', 'furniture', 'other_tenant_income'),
    ('invoice_line_item', 'key_lock', 'other_tenant_income'),
    ('invoice_line_item', 'water', 'other_tenant_income'),
    ('invoice_line_item', 'access_card', 'other_tenant_income'),
    ('invoice_line_item', 'damage', 'other_tenant_income'),
    ('invoice_line_item', 'cleaning', 'other_tenant_income'),
    ('invoice_line_item', 'other', 'other_tenant_income'),
    ('bank_adjustment', 'bank_charge', 'bank_charges'),
    ('bank_adjustment', 'interest_income', 'other_income')
) as mapping(source_type, source_key, system_key)
join public.accounting_accounts accounts
  on accounts.company_id = companies.id
 and accounts.system_key = mapping.system_key
on conflict (company_id, source_type, source_key) do nothing;

insert into public.accounting_category_mappings (
  company_id, source_type, source_key, account_id
)
select
  companies.id,
  'expense_category',
  categories.id::text,
  coalesce(named_account.id, fallback_account.id)
from public.expense_categories categories
cross join public.companies
join public.accounting_accounts fallback_account
  on fallback_account.company_id = companies.id
 and fallback_account.system_key = 'other_operating_expense'
left join public.accounting_accounts named_account
  on named_account.company_id = companies.id
 and named_account.system_key = case
   when lower(categories.name) like '%repair%'
     or lower(categories.name) like '%maintenance%' then 'repairs_maintenance'
   when lower(categories.name) like '%clean%' then 'cleaning_expense'
   when lower(categories.name) like '%electric%'
     or lower(categories.name) like '%water%'
     or lower(categories.name) like '%utilit%' then 'utilities_expense'
   when lower(categories.name) like '%legal%'
     or lower(categories.name) like '%account%'
     or lower(categories.name) like '%professional%' then 'professional_fees'
   when lower(categories.name) like '%bank%' then 'bank_charges'
   when lower(categories.name) like '%salary%'
     or lower(categories.name) like '%staff%'
     or lower(categories.name) like '%wage%' then 'staff_costs'
   when lower(categories.name) like '%office%'
     or lower(categories.name) like '%admin%' then 'office_admin'
   else null
 end
where categories.company_id is null
   or categories.company_id = companies.id
on conflict (company_id, source_type, source_key) do nothing;

insert into storage.buckets (id, name, public)
values ('accounting-documents', 'accounting-documents', false)
on conflict (id) do update set public = false;

alter table public.accounting_accounts enable row level security;
alter table public.accounting_category_mappings enable row level security;
alter table public.accounting_journal_entries enable row level security;
alter table public.accounting_journal_lines enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_lines enable row level security;
alter table public.bank_manual_transactions enable row level security;
alter table public.bank_reconciliation_matches enable row level security;
alter table public.accounting_audit_logs enable row level security;

create policy "accounting_accounts_select_allowed"
on public.accounting_accounts for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

create policy "accounting_category_mappings_select_allowed"
on public.accounting_category_mappings for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

create policy "accounting_journal_entries_select_allowed"
on public.accounting_journal_entries for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

create policy "accounting_journal_lines_select_allowed"
on public.accounting_journal_lines for select to authenticated
using (
  exists (
    select 1 from public.accounting_journal_entries entries
    where entries.id = accounting_journal_lines.journal_entry_id
      and ((select public.is_platform_admin()) or public.can_manage_company(entries.company_id))
  )
);

create policy "accounting_periods_select_allowed"
on public.accounting_periods for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

create policy "bank_accounts_select_allowed"
on public.bank_accounts for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

create policy "bank_statement_imports_select_allowed"
on public.bank_statement_imports for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

create policy "bank_statement_lines_select_allowed"
on public.bank_statement_lines for select to authenticated
using (
  exists (
    select 1 from public.bank_statement_imports imports
    where imports.id = bank_statement_lines.statement_import_id
      and ((select public.is_platform_admin()) or public.can_manage_company(imports.company_id))
  )
);

create policy "bank_manual_transactions_select_allowed"
on public.bank_manual_transactions for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

create policy "bank_reconciliation_matches_select_allowed"
on public.bank_reconciliation_matches for select to authenticated
using (
  exists (
    select 1
    from public.bank_statement_lines lines
    join public.bank_statement_imports imports
      on imports.id = lines.statement_import_id
    where lines.id = bank_reconciliation_matches.statement_line_id
      and ((select public.is_platform_admin()) or public.can_manage_company(imports.company_id))
  )
);

create policy "accounting_audit_logs_select_allowed"
on public.accounting_audit_logs for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

create policy "accounting_documents_select_allowed"
on storage.objects for select to authenticated
using (
  bucket_id = 'accounting-documents'
  and (select public.is_platform_admin())
);

revoke all on table public.accounting_accounts from anon;
revoke all on table public.accounting_category_mappings from anon;
revoke all on table public.accounting_journal_entries from anon;
revoke all on table public.accounting_journal_lines from anon;
revoke all on table public.accounting_periods from anon;
revoke all on table public.bank_accounts from anon;
revoke all on table public.bank_statement_imports from anon;
revoke all on table public.bank_statement_lines from anon;
revoke all on table public.bank_manual_transactions from anon;
revoke all on table public.bank_reconciliation_matches from anon;
revoke all on table public.accounting_audit_logs from anon;

grant select on table public.accounting_accounts to authenticated;
grant select on table public.accounting_category_mappings to authenticated;
grant select on table public.accounting_journal_entries to authenticated;
grant select on table public.accounting_journal_lines to authenticated;
grant select on table public.accounting_periods to authenticated;
grant select on table public.bank_accounts to authenticated;
grant select on table public.bank_statement_imports to authenticated;
grant select on table public.bank_statement_lines to authenticated;
grant select on table public.bank_manual_transactions to authenticated;
grant select on table public.bank_reconciliation_matches to authenticated;
grant select on table public.accounting_audit_logs to authenticated;

revoke insert, update, delete on table public.accounting_accounts from authenticated;
revoke insert, update, delete on table public.accounting_category_mappings from authenticated;
revoke insert, update, delete on table public.accounting_journal_entries from authenticated;
revoke insert, update, delete on table public.accounting_journal_lines from authenticated;
revoke insert, update, delete on table public.accounting_periods from authenticated;
revoke insert, update, delete on table public.bank_accounts from authenticated;
revoke insert, update, delete on table public.bank_statement_imports from authenticated;
revoke insert, update, delete on table public.bank_statement_lines from authenticated;
revoke insert, update, delete on table public.bank_manual_transactions from authenticated;
revoke insert, update, delete on table public.bank_reconciliation_matches from authenticated;
revoke insert, update, delete on table public.accounting_audit_logs from authenticated;

comment on table public.accounting_accounts is
  'Company chart of accounts used by management P&L, ledger and bank adjustments.';
comment on table public.bank_statement_imports is
  'Immutable bank statement header and retained source document for reconciliation.';
comment on table public.bank_reconciliation_matches is
  'Many-to-many links supporting automatic, manual, split, merge and adjustment matching.';
