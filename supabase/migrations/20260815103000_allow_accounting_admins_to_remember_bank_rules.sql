drop policy if exists "bank_reconciliation_rules_insert_allowed" on public.bank_reconciliation_rules;
create policy "bank_reconciliation_rules_insert_allowed"
on public.bank_reconciliation_rules for insert to authenticated
with check ((select public.is_platform_admin()) or public.can_manage_company(company_id));

drop policy if exists "bank_reconciliation_rules_update_allowed" on public.bank_reconciliation_rules;
create policy "bank_reconciliation_rules_update_allowed"
on public.bank_reconciliation_rules for update to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id))
with check ((select public.is_platform_admin()) or public.can_manage_company(company_id));

grant insert, update on table public.bank_reconciliation_rules to authenticated;

comment on policy "bank_reconciliation_rules_insert_allowed" on public.bank_reconciliation_rules is
  'Accounting managers may save a recurring bank-description suggestion for a company they manage.';

comment on policy "bank_reconciliation_rules_update_allowed" on public.bank_reconciliation_rules is
  'Accounting managers may update a recurring bank-description suggestion for a company they manage.';
