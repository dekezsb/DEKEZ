create table if not exists public.bank_reconciliation_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  bank_account_id uuid references public.bank_accounts(id) on delete cascade,
  direction text not null check (direction in ('credit', 'debit')),
  bank_description_key text not null,
  accounting_account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  default_description text not null,
  use_count integer not null default 1 check (use_count > 0),
  last_used_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, bank_account_id, direction, bank_description_key)
);

create index if not exists bank_reconciliation_rules_lookup_idx
  on public.bank_reconciliation_rules (company_id, bank_account_id, direction, bank_description_key);

alter table public.bank_reconciliation_rules enable row level security;

drop policy if exists "bank_reconciliation_rules_select_allowed" on public.bank_reconciliation_rules;
create policy "bank_reconciliation_rules_select_allowed"
on public.bank_reconciliation_rules for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

revoke all on table public.bank_reconciliation_rules from anon;
grant select on table public.bank_reconciliation_rules to authenticated;
revoke insert, update, delete on table public.bank_reconciliation_rules from authenticated;

comment on table public.bank_reconciliation_rules is
  'Admin-confirmed bank description mappings used to prefill recurring reconciliation categories without auto-posting.';
