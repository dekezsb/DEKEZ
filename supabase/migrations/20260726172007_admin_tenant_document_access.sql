drop policy if exists "tenant_documents_insert_admin" on public.tenant_documents;
create policy "tenant_documents_insert_admin"
on public.tenant_documents
for insert
to authenticated
with check (
  public.is_platform_admin()
  or exists (
    select 1
    from public.tenant_records as tenant_records
    where tenant_records.id = tenant_documents.tenant_record_id
      and public.can_manage_property(tenant_records.property_id)
  )
  or exists (
    select 1
    from public.tenant_applications as tenant_applications
    where tenant_applications.id = tenant_documents.tenant_application_id
      and public.can_manage_property(tenant_applications.property_id)
  )
);

drop policy if exists "tenant_documents_select_allowed" on public.tenant_documents;
create policy "tenant_documents_select_allowed"
on public.tenant_documents
for select
to authenticated
using (
  tenant_id = auth.uid()
  or public.is_platform_admin()
  or exists (
    select 1
    from public.tenant_records as tenant_records
    where tenant_records.id = tenant_documents.tenant_record_id
      and public.can_manage_property(tenant_records.property_id)
  )
  or exists (
    select 1
    from public.tenant_applications as tenant_applications
    where tenant_applications.id = tenant_documents.tenant_application_id
      and public.can_manage_property(tenant_applications.property_id)
  )
);
