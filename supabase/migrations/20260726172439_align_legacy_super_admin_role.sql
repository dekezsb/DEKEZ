create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_profile_role() = 'super_admin';
$$;
