-- Applied remotely as migration 20260729064209.
create table if not exists public.document_archive_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  source_type text not null check (
    source_type in (
      'rental_invoice',
      'tenancy_agreement',
      'utility_bill',
      'expense_bill'
    )
  ),
  source_id uuid not null,
  archive_year integer not null check (archive_year between 2000 and 2200),
  status text not null default 'pending' check (
    status in ('pending', 'processing', 'completed', 'failed')
  ),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  drive_file_id text,
  drive_url text,
  drive_path text,
  content_checksum text,
  archived_at timestamptz,
  processing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id)
);

create index if not exists document_archive_jobs_pending_idx
  on public.document_archive_jobs (status, next_attempt_at, created_at)
  where status in ('pending', 'failed');

create index if not exists document_archive_jobs_source_idx
  on public.document_archive_jobs (source_type, source_id);

alter table public.document_archive_jobs enable row level security;

revoke all on public.document_archive_jobs from anon, authenticated;

create or replace function public.enqueue_document_archive(
  p_source_type text,
  p_source_id uuid,
  p_archive_year integer,
  p_organization_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_source_id is null
     or p_archive_year is null
     or p_archive_year < 2000
     or p_archive_year > 2200 then
    return;
  end if;

  insert into public.document_archive_jobs (
    organization_id,
    source_type,
    source_id,
    archive_year
  )
  values (
    p_organization_id,
    p_source_type,
    p_source_id,
    p_archive_year
  )
  on conflict (source_type, source_id)
  do update set
    organization_id = coalesce(
      excluded.organization_id,
      public.document_archive_jobs.organization_id
    ),
    archive_year = excluded.archive_year,
    status = 'pending',
    next_attempt_at = now(),
    last_error = null,
    updated_at = now();
end;
$$;

revoke all on function public.enqueue_document_archive(text, uuid, integer, uuid)
  from public, anon, authenticated;

create or replace function public.queue_rental_invoice_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enqueue_document_archive(
    'rental_invoice',
    new.id,
    extract(year from coalesce(new.invoice_date, new.bill_month, current_date))::integer,
    new.organization_id
  );
  return new;
end;
$$;

drop trigger if exists queue_rental_invoice_archive_trigger
  on public.rent_bills;
create trigger queue_rental_invoice_archive_trigger
after insert or update on public.rent_bills
for each row execute function public.queue_rental_invoice_archive();

create or replace function public.queue_verified_receipt_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  bill_year integer;
  bill_organization_id uuid;
begin
  if new.rent_bill_id is null
     or new.verification_status <> 'verified'
     or new.receipt_url is null then
    return new;
  end if;

  select
    extract(year from coalesce(invoice_date, bill_month, current_date))::integer,
    organization_id
  into bill_year, bill_organization_id
  from public.rent_bills
  where id = new.rent_bill_id;

  perform public.enqueue_document_archive(
    'rental_invoice',
    new.rent_bill_id,
    bill_year,
    bill_organization_id
  );
  return new;
end;
$$;

drop trigger if exists queue_verified_receipt_archive_trigger
  on public.payment_submissions;
create trigger queue_verified_receipt_archive_trigger
after insert or update of verification_status, receipt_url, rent_bill_id
on public.payment_submissions
for each row execute function public.queue_verified_receipt_archive();

create or replace function public.queue_tenancy_agreement_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  agreement_organization_id uuid;
begin
  select organization_id
  into agreement_organization_id
  from public.tenancies
  where id = new.tenancy_id;

  perform public.enqueue_document_archive(
    'tenancy_agreement',
    new.id,
    extract(
      year from coalesce(new.term_start_date, new.generated_at::date, current_date)
    )::integer,
    agreement_organization_id
  );
  return new;
end;
$$;

drop trigger if exists queue_tenancy_agreement_archive_trigger
  on public.tenancy_agreements;
create trigger queue_tenancy_agreement_archive_trigger
after insert or update on public.tenancy_agreements
for each row execute function public.queue_tenancy_agreement_archive();

create or replace function public.queue_checked_out_agreement_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.checkout_date is distinct from old.checkout_date
     or new.status is distinct from old.status then
    insert into public.document_archive_jobs (
      organization_id,
      source_type,
      source_id,
      archive_year
    )
    select
      new.organization_id,
      'tenancy_agreement',
      agreements.id,
      extract(
        year from coalesce(
          agreements.term_start_date,
          agreements.generated_at::date,
          current_date
        )
      )::integer
    from public.tenancy_agreements agreements
    where agreements.tenancy_id = new.id
    on conflict (source_type, source_id)
    do update set
      status = 'pending',
      next_attempt_at = now(),
      last_error = null,
      updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists queue_checked_out_agreement_archive_trigger
  on public.tenancies;
create trigger queue_checked_out_agreement_archive_trigger
after update of checkout_date, status on public.tenancies
for each row execute function public.queue_checked_out_agreement_archive();

create or replace function public.queue_utility_bill_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enqueue_document_archive(
    'utility_bill',
    new.id,
    extract(year from coalesce(new.bill_month, current_date))::integer,
    new.organization_id
  );
  return new;
end;
$$;

drop trigger if exists queue_utility_bill_archive_trigger
  on public.utility_bills;
create trigger queue_utility_bill_archive_trigger
after insert or update on public.utility_bills
for each row execute function public.queue_utility_bill_archive();

create or replace function public.queue_expense_bill_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.enqueue_document_archive(
    'expense_bill',
    new.id,
    extract(year from coalesce(new.expense_date, current_date))::integer,
    new.organization_id
  );
  return new;
end;
$$;

drop trigger if exists queue_expense_bill_archive_trigger
  on public.expenses;
create trigger queue_expense_bill_archive_trigger
after insert or update on public.expenses
for each row execute function public.queue_expense_bill_archive();

create or replace function public.queue_expense_attachment_archive()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  expense_year integer;
  expense_organization_id uuid;
begin
  select
    extract(year from coalesce(expense_date, current_date))::integer,
    organization_id
  into expense_year, expense_organization_id
  from public.expenses
  where id = new.expense_id;

  perform public.enqueue_document_archive(
    'expense_bill',
    new.expense_id,
    expense_year,
    expense_organization_id
  );
  return new;
end;
$$;

drop trigger if exists queue_expense_attachment_archive_trigger
  on public.expense_attachments;
create trigger queue_expense_attachment_archive_trigger
after insert or update on public.expense_attachments
for each row execute function public.queue_expense_attachment_archive();

insert into public.document_archive_jobs (
  organization_id,
  source_type,
  source_id,
  archive_year
)
select
  bills.organization_id,
  'rental_invoice',
  bills.id,
  extract(year from coalesce(bills.invoice_date, bills.bill_month, current_date))::integer
from public.rent_bills bills
where extract(year from coalesce(bills.invoice_date, bills.bill_month, current_date))
  in (2025, 2026)
on conflict (source_type, source_id) do nothing;

insert into public.document_archive_jobs (
  organization_id,
  source_type,
  source_id,
  archive_year
)
select
  tenancies.organization_id,
  'tenancy_agreement',
  agreements.id,
  extract(
    year from coalesce(
      agreements.term_start_date,
      agreements.generated_at::date,
      current_date
    )
  )::integer
from public.tenancy_agreements agreements
join public.tenancies tenancies on tenancies.id = agreements.tenancy_id
where extract(
  year from coalesce(
    agreements.term_start_date,
    agreements.generated_at::date,
    current_date
  )
) in (2025, 2026)
on conflict (source_type, source_id) do nothing;

insert into public.document_archive_jobs (
  organization_id,
  source_type,
  source_id,
  archive_year
)
select
  bills.organization_id,
  'utility_bill',
  bills.id,
  extract(year from coalesce(bills.bill_month, current_date))::integer
from public.utility_bills bills
where extract(year from coalesce(bills.bill_month, current_date)) in (2025, 2026)
on conflict (source_type, source_id) do nothing;

insert into public.document_archive_jobs (
  organization_id,
  source_type,
  source_id,
  archive_year
)
select
  expenses.organization_id,
  'expense_bill',
  expenses.id,
  extract(year from coalesce(expenses.expense_date, current_date))::integer
from public.expenses expenses
where extract(year from coalesce(expenses.expense_date, current_date)) in (2025, 2026)
on conflict (source_type, source_id) do nothing;
