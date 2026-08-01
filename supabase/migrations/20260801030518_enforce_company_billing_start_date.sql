alter table public.rent_bills
  add constraint rent_bills_company_start_date_check
  check (
    bill_month >= date '2024-09-01'
    or removed_at is not null
  )
  not valid;

alter table public.rent_bills
  validate constraint rent_bills_company_start_date_check;

comment on constraint rent_bills_company_start_date_check on public.rent_bills is
  'Active DEKEZ rental invoices cannot predate the company billing start on 2024-09-01.';
