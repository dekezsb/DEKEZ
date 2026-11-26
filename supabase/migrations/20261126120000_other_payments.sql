-- "Other payment" feature (tenant portal + management portal).
--
-- Other payments (electricity top-up, lost key / key replacement, deposit
-- balance, other) reuse payment_submissions and payment_attachments, marked with
-- bill_type = 'other_payment'. Verification posts one `payments` row and never
-- touches rent_bills, invoice lines, journals or receivables.
--
-- Additive and safe to apply before the code is deployed: one nullable column,
-- one partial index and one check that no existing row can violate (there are no
-- 'other_payment' rows yet).

alter table public.payment_submissions
  add column if not exists submitted_by_staff_id uuid
    references auth.users(id) on delete set null;

comment on column public.payment_submissions.submitted_by_staff_id is
  'Set when management submitted the slip on behalf of the tenant (Other payment). Null when the tenant submitted it.';

create index if not exists payment_submissions_other_payment_status
  on public.payment_submissions (verification_status, created_at desc)
  where bill_type = 'other_payment';

-- An other payment must never be linked to a rent invoice, so it can never mark
-- a rent bill paid or change its outstanding balance.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_submissions_other_payment_no_rent_bill'
      and conrelid = 'public.payment_submissions'::regclass
  ) then
    alter table public.payment_submissions
      add constraint payment_submissions_other_payment_no_rent_bill
      check (bill_type <> 'other_payment' or rent_bill_id is null);
  end if;
end
$$;
