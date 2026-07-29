-- Retain verified payment evidence with its rental invoice archive.
alter table public.payment_submissions
  add column if not exists retain_until date;

update public.payment_submissions submissions
set retain_until = greatest(
  coalesce(
    submissions.retain_until,
    (submissions.payment_date + interval '7 years')::date
  ),
  coalesce(
    bills.retain_until,
    (submissions.payment_date + interval '7 years')::date
  )
)
from public.rent_bills bills
where bills.id = submissions.rent_bill_id
  and submissions.receipt_url is not null;

update public.payment_submissions
set retain_until = (payment_date + interval '7 years')::date
where receipt_url is not null
  and retain_until is null;

create index if not exists payment_submissions_invoice_receipts_idx
  on public.payment_submissions (rent_bill_id, verification_status, verified_at)
  where receipt_url is not null;

create or replace function public.set_payment_receipt_retention()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  bill_retain_until date;
begin
  if new.receipt_url is null then
    return new;
  end if;

  if new.rent_bill_id is not null then
    select bills.retain_until
      into bill_retain_until
    from public.rent_bills bills
    where bills.id = new.rent_bill_id;
  end if;

  new.retain_until := greatest(
    coalesce(
      new.retain_until,
      (new.payment_date + interval '7 years')::date
    ),
    coalesce(
      bill_retain_until,
      (new.payment_date + interval '7 years')::date
    )
  );

  return new;
end;
$$;

drop trigger if exists set_payment_receipt_retention
  on public.payment_submissions;
create trigger set_payment_receipt_retention
before insert or update of receipt_url, rent_bill_id, payment_date
on public.payment_submissions
for each row
execute function public.set_payment_receipt_retention();

create or replace function public.protect_verified_payment_receipt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.verification_status = 'verified'
      and old.receipt_url is not null
      and current_date < coalesce(
        old.retain_until,
        (old.payment_date + interval '7 years')::date
      )
    then
      raise exception
        'Verified payment receipts must be retained until %.',
        coalesce(
          old.retain_until,
          (old.payment_date + interval '7 years')::date
        );
    end if;

    return old;
  end if;

  if old.verification_status = 'verified'
    and old.receipt_url is not null
    and new.receipt_url is distinct from old.receipt_url
    and current_date < coalesce(
      old.retain_until,
      (old.payment_date + interval '7 years')::date
    )
  then
    raise exception
      'Verified payment receipts must be retained until %.',
      coalesce(
        old.retain_until,
        (old.payment_date + interval '7 years')::date
      );
  end if;

  return new;
end;
$$;

drop trigger if exists protect_verified_payment_receipt
  on public.payment_submissions;
create trigger protect_verified_payment_receipt
before delete or update of receipt_url
on public.payment_submissions
for each row
execute function public.protect_verified_payment_receipt();

comment on column public.payment_submissions.retain_until is
  'Minimum retention date for uploaded payment evidence linked to invoices.';
