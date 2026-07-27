alter table public.profiles
  add column if not exists registration_status text,
  add column if not exists registration_reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists registration_reviewed_at timestamptz,
  add column if not exists registration_rejection_reason text;

update public.profiles
set
  registration_status = 'approved',
  registration_reviewed_at = coalesce(registration_reviewed_at, now())
where registration_status is null;

alter table public.profiles
  alter column registration_status set default 'pending_verification',
  alter column registration_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_registration_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_registration_status_check
      check (registration_status in ('pending_verification', 'approved', 'rejected'));
  end if;
end
$$;

create index if not exists profiles_registration_review_idx
  on public.profiles (role, registration_status, created_at desc);

revoke update on public.profiles from authenticated;
grant update (full_name, phone, avatar_url, updated_at)
  on public.profiles
  to authenticated;
