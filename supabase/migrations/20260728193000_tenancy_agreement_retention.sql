alter table public.tenancy_agreements
  add column if not exists retention_until date;

update public.tenancy_agreements
set retention_until = (
  greatest(
    coalesce(term_end_date, generated_at::date, current_date),
    coalesce(signed_at::date, generated_at::date, current_date)
  ) + interval '7 years'
)::date
where retention_until is null
   or retention_until < (
     greatest(
       coalesce(term_end_date, generated_at::date, current_date),
       coalesce(signed_at::date, generated_at::date, current_date)
     ) + interval '7 years'
   )::date;

create index if not exists tenancy_agreements_retention_until_idx
  on public.tenancy_agreements (retention_until);

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
    if old.retention_until is null or old.retention_until > current_date then
      raise exception
        'Tenancy agreement % must be retained until %',
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

drop trigger if exists tenancy_agreements_retention_guard
  on public.tenancy_agreements;

create trigger tenancy_agreements_retention_guard
before insert or update or delete
on public.tenancy_agreements
for each row
execute function public.enforce_tenancy_agreement_retention();
