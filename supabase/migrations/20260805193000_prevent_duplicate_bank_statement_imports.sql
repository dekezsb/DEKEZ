alter table public.bank_statement_imports
  add column if not exists original_file_hash text;

create unique index if not exists bank_statement_imports_active_file_hash_uidx
  on public.bank_statement_imports (bank_account_id, original_file_hash)
  where original_file_hash is not null and status <> 'void';

comment on column public.bank_statement_imports.original_file_hash is
  'SHA-256 of the retained source statement. Prevents accidental duplicate active imports.';

alter table public.bank_reconciliation_matches
  drop constraint if exists bank_reconciliation_matches_source_type_check;

alter table public.bank_reconciliation_matches
  add constraint bank_reconciliation_matches_source_type_check check (
    source_type in (
      'payment', 'rent_bill', 'expense_payment_batch', 'staff_reimbursement_payout',
      'cash_bank_in', 'expense', 'manual_bank_transaction'
    )
  );

alter table public.bank_manual_transactions
  add column if not exists property_id uuid references public.properties(id) on delete restrict;

create index if not exists bank_manual_transactions_property_date_idx
  on public.bank_manual_transactions (property_id, transaction_date desc)
  where property_id is not null;

insert into public.accounting_accounts (
  company_id, code, name, account_type, report_group, normal_balance,
  system_key, description, is_system, sort_order
)
select companies.id, seed.code, seed.name, seed.account_type, seed.report_group,
  seed.normal_balance, seed.system_key, seed.description, true, seed.sort_order
from public.companies
cross join (
  values
    ('1090', 'Bank Transfer Clearing', 'asset', 'current_asset', 'debit', 'bank_transfer_clearing', 'Transfers between company bank accounts awaiting the other bank line.', 1090),
    ('1200', 'Fixed Assets', 'asset', 'non_current_asset', 'debit', 'fixed_assets', 'Furniture, equipment, meters, locks and other capital assets.', 1200),
    ('2400', 'Loans Payable', 'liability', 'non_current_liability', 'credit', 'loans_payable', 'Company borrowings and loan principal outstanding.', 2400),
    ('2500', 'Tax Payable', 'liability', 'current_liability', 'credit', 'tax_payable', 'Taxes assessed but not yet paid.', 2500),
    ('3100', 'Owner Capital', 'equity', 'equity', 'credit', 'owner_capital', 'Owner funds introduced into the company.', 3100),
    ('5050', 'Property Rental Cost', 'expense', 'cost_of_sales', 'debit', 'property_rental_cost', 'Rent paid for properties used to earn tenant rental income.', 5050),
    ('5700', 'Tax Expense', 'expense', 'operating_expense', 'debit', 'tax_expense', 'Company taxes and statutory charges expensed in the period.', 5700)
) as seed(
  code, name, account_type, report_group, normal_balance,
  system_key, description, sort_order
)
on conflict (company_id, code) do nothing;
