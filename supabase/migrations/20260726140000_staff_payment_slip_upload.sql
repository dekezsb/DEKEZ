drop policy if exists "payment_submissions_insert_own" on public.payment_submissions;
drop policy if exists "payment_submissions_insert_allowed" on public.payment_submissions;
create policy "payment_submissions_insert_allowed" on public.payment_submissions
for insert with check (
  tenant_id = auth.uid()
  or public.is_platform_admin()
  or (
    property_id is not null
    and public.can_access_property(property_id)
  )
);

drop policy if exists "payment_attachments_insert_own" on public.payment_attachments;
drop policy if exists "payment_attachments_insert_allowed" on public.payment_attachments;
create policy "payment_attachments_insert_allowed" on public.payment_attachments
for insert with check (
  tenant_id = auth.uid()
  or public.is_platform_admin()
  or exists (
    select 1
    from public.payment_submissions as submissions
    where submissions.id = payment_attachments.payment_submission_id
      and submissions.property_id is not null
      and public.can_access_property(submissions.property_id)
  )
);
