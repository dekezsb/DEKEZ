create or replace function public.prevent_rental_invoice_early_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if
    old.status = 'draft'
    and coalesce(old.paid_amount, 0) = 0
    and current_setting('dekez.allow_draft_invoice_delete', true) = 'on'
  then
    return old;
  end if;

  if
    current_setting('dekez.allow_checkout_invoice_delete', true) = 'on'
    and exists (
      select 1
      from public.tenancies
      where id = old.tenancy_id
        and checkout_date is not null
        and status <> 'active'
    )
  then
    return old;
  end if;

  raise exception
    'Rental invoice % cannot be permanently deleted. Void it instead.',
    old.invoice_number;
end;
$$;

revoke all on function public.prevent_rental_invoice_early_delete()
from public, anon, authenticated;

create or replace function public.remove_checked_out_tenancy_documents()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  perform set_config('dekez.allow_checkout_invoice_delete', 'on', true);

  delete from public.document_archive_jobs
  where source_type = 'tenancy_agreement'
    and source_id in (
      select id
      from public.tenancy_agreements
      where tenancy_id = new.id
    );

  delete from public.tenancy_agreement_verification_logs
  where agreement_id in (
    select id
    from public.tenancy_agreements
    where tenancy_id = new.id
  );

  delete from public.rent_bills
  where tenancy_id = new.id;

  delete from public.tenancy_agreements
  where tenancy_id = new.id;

  return new;
end;
$$;

drop trigger if exists remove_checked_out_tenancy_documents_trigger
  on public.tenancies;
create trigger remove_checked_out_tenancy_documents_trigger
after update of checkout_date, status on public.tenancies
for each row
when (
  new.checkout_date is not null
  and new.status <> 'active'
  and (
    old.checkout_date is distinct from new.checkout_date
    or old.status is distinct from new.status
  )
)
execute function public.remove_checked_out_tenancy_documents();

revoke all on function public.remove_checked_out_tenancy_documents()
from public, anon, authenticated;

delete from public.document_archive_jobs
where source_type = 'tenancy_agreement'
  and source_id in (
    select agreement.id
    from public.tenancy_agreements as agreement
    join public.tenancies as tenancy on tenancy.id = agreement.tenancy_id
    where tenancy.checkout_date =
      (now() at time zone 'Asia/Kuala_Lumpur')::date
      and tenancy.status <> 'active'
  );

delete from public.tenancy_agreement_verification_logs
where agreement_id in (
  select agreement.id
  from public.tenancy_agreements as agreement
  join public.tenancies as tenancy on tenancy.id = agreement.tenancy_id
  where tenancy.checkout_date =
    (now() at time zone 'Asia/Kuala_Lumpur')::date
    and tenancy.status <> 'active'
);

select set_config('dekez.allow_checkout_invoice_delete', 'on', true);

delete from public.rent_bills
where tenancy_id in (
  select id
  from public.tenancies
  where checkout_date = (now() at time zone 'Asia/Kuala_Lumpur')::date
    and status <> 'active'
);

delete from public.tenancy_agreements
where tenancy_id in (
  select id
  from public.tenancies
  where checkout_date = (now() at time zone 'Asia/Kuala_Lumpur')::date
    and status <> 'active'
);
