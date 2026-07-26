drop policy if exists "company members view companies" on public.companies;
create policy "company members view companies"
on public.companies
for select
to authenticated
using (
  public.is_platform_admin()
  or exists (
    select 1
    from public.company_users as company_users
    where company_users.company_id = companies.id
      and coalesce(company_users.user_id, company_users.profile_id) = auth.uid()
      and company_users.status::text = 'active'
  )
);

drop policy if exists "company users visible within company" on public.company_users;
create policy "company users visible within company"
on public.company_users
for select
to authenticated
using (
  public.is_platform_admin()
  or public.has_company_role(
    company_id,
    array['owner'::public.app_role, 'admin_team'::public.app_role]
  )
  or coalesce(user_id, profile_id) = auth.uid()
);
