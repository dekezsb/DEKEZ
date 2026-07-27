drop policy if exists "profiles_insert_self" on public.profiles;

create policy "profiles_insert_self"
on public.profiles
for insert
to authenticated
with check (
  id = (select auth.uid())
  and role = 'tenant'
  and global_role = 'tenant'::public.app_role
  and registration_status = 'pending_verification'
  and organization_id is null
  and registration_reviewed_by is null
  and registration_reviewed_at is null
  and registration_rejection_reason is null
);

revoke execute on function public.handle_new_user() from anon, authenticated;
