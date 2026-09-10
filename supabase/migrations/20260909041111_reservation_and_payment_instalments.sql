-- Existing registrations retain their check-in workflow.
alter table public.tenant_applications
  add column if not exists registration_mode text not null default 'check_in'
  check (registration_mode in ('check_in', 'reservation'));

alter table public.payment_submissions
  add column if not exists instalment boolean not null default false,
  add column if not exists submission_key uuid,
  add column if not exists payment_note text;
create unique index if not exists payment_submissions_submission_key_unique
  on public.payment_submissions (submission_key) where submission_key is not null;
drop index if exists public.payment_submissions_one_pending_per_rent_bill;
create unique index payment_submissions_one_pending_per_rent_bill
  on public.payment_submissions (rent_bill_id)
  where rent_bill_id is not null and verification_status = 'pending_verification'
    and instalment = false;
