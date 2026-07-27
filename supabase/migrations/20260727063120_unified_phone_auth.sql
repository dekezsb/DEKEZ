alter table public.profiles
  add column if not exists normalized_phone text
    generated always as (
      nullif(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), '')
    ) stored;

create unique index if not exists profiles_normalized_phone_unique_idx
  on public.profiles (normalized_phone)
  where normalized_phone is not null;

create index if not exists profiles_registration_phone_idx
  on public.profiles (registration_status, normalized_phone);

create or replace function public.current_profile_role()
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then null
    when coalesce(
      (
        select profiles.registration_status
        from public.profiles as profiles
        where profiles.id = (select auth.uid())
      ),
      'pending_verification'
    ) <> 'approved' then null
    else coalesce(
      nullif((select auth.jwt()) -> 'app_metadata' ->> 'role', ''),
      (
        select profiles.role::text
        from public.profiles as profiles
        where profiles.id = (select auth.uid())
      ),
      'tenant'
    )
  end;
$$;
