drop policy if exists "cash_bank_ins_select_allowed" on public.cash_bank_ins;
create policy "cash_bank_ins_select_allowed"
on public.cash_bank_ins
for select
to authenticated
using (
  public.is_platform_admin()
  or public.can_manage_company(company_id)
);

drop policy if exists "expenses_select_allowed" on public.expenses;
create policy "expenses_select_allowed"
on public.expenses
for select
to authenticated
using (
  public.is_platform_admin()
  or uploaded_by = (select auth.uid())
  or (property_id is not null and public.owns_property(property_id))
  or (company_id is not null and public.can_manage_company(company_id))
);
