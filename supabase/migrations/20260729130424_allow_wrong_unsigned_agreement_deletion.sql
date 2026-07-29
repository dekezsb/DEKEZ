create table if not exists public.tenancy_agreement_deletion_logs (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null,
  tenancy_id uuid,
  performed_by uuid not null references auth.users(id) on delete restrict,
  performed_at timestamptz not null default now(),
  reason text not null,
  original_agreement jsonb not null
);

create index if not exists tenancy_agreement_deletion_logs_agreement_idx
  on public.tenancy_agreement_deletion_logs (agreement_id, performed_at desc);

alter table public.tenancy_agreement_deletion_logs enable row level security;

drop policy if exists "tenancy_agreement_deletion_logs_select_admin"
  on public.tenancy_agreement_deletion_logs;
create policy "tenancy_agreement_deletion_logs_select_admin"
on public.tenancy_agreement_deletion_logs
for select
to authenticated
using (public.current_profile_role() in ('super_admin', 'admin'));

grant select on public.tenancy_agreement_deletion_logs to authenticated;
grant all on public.tenancy_agreement_deletion_logs to service_role;

create or replace function public.enforce_tenancy_agreement_retention()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  required_retention date;
begin
  if tg_op = 'DELETE' then
    if old.signed_at is not null
      or old.status::text in ('signed', 'renewal_signed')
    then
      raise exception
        'Signed tenancy agreement % must be retained until %',
        old.id,
        coalesce(old.retention_until::text, 'a retention date is assigned');
    end if;

    return old;
  end if;

  required_retention := (
    greatest(
      coalesce(new.term_end_date, new.generated_at::date, current_date),
      coalesce(new.signed_at::date, new.generated_at::date, current_date)
    ) + interval '7 years'
  )::date;

  if new.retention_until is null or new.retention_until < required_retention then
    new.retention_until := required_retention;
  end if;

  return new;
end;
$$;
