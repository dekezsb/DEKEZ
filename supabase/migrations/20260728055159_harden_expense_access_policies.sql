drop policy if exists "expense_categories_select_allowed" on public.expense_categories;
create policy "expense_categories_select_allowed"
on public.expense_categories
for select
to authenticated
using (
  public.is_platform_admin()
  or company_id is null
  or public.is_company_member(company_id)
);

drop policy if exists "expense_categories_manage_admin_owner" on public.expense_categories;

drop policy if exists "expense_categories_insert_admin" on public.expense_categories;
create policy "expense_categories_insert_admin"
on public.expense_categories
for insert
to authenticated
with check (
  public.is_platform_admin()
  or (
    company_id is not null
    and public.current_profile_role() = 'admin_team'
    and public.can_manage_company(company_id)
  )
);

drop policy if exists "expense_categories_update_admin" on public.expense_categories;
create policy "expense_categories_update_admin"
on public.expense_categories
for update
to authenticated
using (
  public.is_platform_admin()
  or (
    company_id is not null
    and public.current_profile_role() = 'admin_team'
    and public.can_manage_company(company_id)
  )
)
with check (
  public.is_platform_admin()
  or (
    company_id is not null
    and public.current_profile_role() = 'admin_team'
    and public.can_manage_company(company_id)
  )
);

drop policy if exists "expenses_insert_staff" on public.expenses;
create policy "expenses_insert_staff"
on public.expenses
for insert
to authenticated
with check (uploaded_by = (select auth.uid()));

drop policy if exists "expenses_update_admin_owner" on public.expenses;
create policy "expenses_update_admin"
on public.expenses
for update
to authenticated
using (
  public.is_platform_admin()
  or (
    company_id is not null
    and public.current_profile_role() = 'admin_team'
    and public.can_manage_company(company_id)
  )
)
with check (
  public.is_platform_admin()
  or (
    company_id is not null
    and public.current_profile_role() = 'admin_team'
    and public.can_manage_company(company_id)
  )
);

drop policy if exists "expense_attachments_select_allowed" on public.expense_attachments;
create policy "expense_attachments_select_allowed"
on public.expense_attachments
for select
to authenticated
using (
  public.is_platform_admin()
  or uploaded_by = (select auth.uid())
  or exists (
    select 1
    from public.expenses
    where expenses.id = expense_attachments.expense_id
      and (
        expenses.uploaded_by = (select auth.uid())
        or (expenses.property_id is not null and public.owns_property(expenses.property_id))
        or (expenses.company_id is not null and public.can_manage_company(expenses.company_id))
      )
  )
);

drop policy if exists "expense_attachments_insert_owner" on public.expense_attachments;
create policy "expense_attachments_insert_owner"
on public.expense_attachments
for insert
to authenticated
with check (uploaded_by = (select auth.uid()));

drop policy if exists "expense_receipts_storage_insert_own" on storage.objects;
create policy "expense_receipts_storage_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'expense-receipts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists "expense_receipts_storage_select_allowed" on storage.objects;
create policy "expense_receipts_storage_select_allowed"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'expense-receipts'
  and (
    public.is_platform_admin()
    or (storage.foldername(name))[1] = (select auth.uid())::text
  )
);

grant select, insert, update on table public.expense_categories to authenticated;
grant select, insert, update on table public.expenses to authenticated;
grant select, insert on table public.expense_attachments to authenticated;
