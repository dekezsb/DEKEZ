alter table public.profiles
  add column if not exists bank_name text,
  add column if not exists bank_account_holder text,
  add column if not exists bank_account_number text;

grant update (
  bank_name,
  bank_account_holder,
  bank_account_number,
  updated_at
) on public.profiles to authenticated;

comment on column public.profiles.bank_name is
  'Bank used for approved staff claim reimbursements.';
comment on column public.profiles.bank_account_holder is
  'Account holder used for approved staff claim reimbursements.';
comment on column public.profiles.bank_account_number is
  'Account number used for approved staff claim reimbursements.';
