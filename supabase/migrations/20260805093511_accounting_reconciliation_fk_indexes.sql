-- Cover accounting foreign keys used by audit and reconciliation lookups.
create index if not exists accounting_audit_logs_performed_by_idx
  on public.accounting_audit_logs (performed_by)
  where performed_by is not null;
create index if not exists accounting_journal_entries_created_by_idx
  on public.accounting_journal_entries (created_by)
  where created_by is not null;
create index if not exists accounting_journal_entries_reversed_entry_idx
  on public.accounting_journal_entries (reversed_entry_id)
  where reversed_entry_id is not null;
create index if not exists accounting_journal_lines_property_idx
  on public.accounting_journal_lines (property_id)
  where property_id is not null;
create index if not exists accounting_journal_lines_tenant_idx
  on public.accounting_journal_lines (tenant_id)
  where tenant_id is not null;
create index if not exists accounting_periods_locked_by_idx
  on public.accounting_periods (locked_by)
  where locked_by is not null;
create index if not exists bank_accounts_ledger_account_idx
  on public.bank_accounts (accounting_account_id);
create index if not exists bank_accounts_created_by_idx
  on public.bank_accounts (created_by)
  where created_by is not null;
create index if not exists bank_manual_transactions_company_idx
  on public.bank_manual_transactions (company_id, transaction_date desc);
create index if not exists bank_manual_transactions_offset_account_idx
  on public.bank_manual_transactions (offset_account_id);
create index if not exists bank_manual_transactions_created_by_idx
  on public.bank_manual_transactions (created_by);
create index if not exists bank_reconciliation_matches_created_by_idx
  on public.bank_reconciliation_matches (created_by);
create index if not exists bank_statement_imports_company_idx
  on public.bank_statement_imports (company_id, period_end desc);
create index if not exists bank_statement_imports_created_by_idx
  on public.bank_statement_imports (created_by);
create index if not exists bank_statement_imports_reconciled_by_idx
  on public.bank_statement_imports (reconciled_by)
  where reconciled_by is not null;
