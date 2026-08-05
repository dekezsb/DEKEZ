alter table public.bank_accounts
  add column if not exists account_number text;

alter table public.bank_accounts
  drop constraint if exists bank_accounts_account_number_format_check;

alter table public.bank_accounts
  add constraint bank_accounts_account_number_format_check
  check (account_number is null or account_number ~ '^[0-9]{6,30}$');

create unique index if not exists bank_accounts_company_bank_number_unique
  on public.bank_accounts (company_id, lower(bank_name), account_number)
  where account_number is not null;

comment on column public.bank_accounts.account_number is
  'Full bank account number, visible only through the authorised accounting module. account_number_last4 remains as a derived compatibility field.';
