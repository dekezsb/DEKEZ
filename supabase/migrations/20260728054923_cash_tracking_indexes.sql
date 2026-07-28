create index if not exists cash_bank_ins_recorded_by_idx
  on public.cash_bank_ins (recorded_by);

create index if not exists cash_bank_ins_cancelled_by_idx
  on public.cash_bank_ins (cancelled_by)
  where cancelled_by is not null;

create index if not exists expenses_company_id_idx
  on public.expenses (company_id);

create index if not exists expenses_property_id_idx
  on public.expenses (property_id)
  where property_id is not null;

create index if not exists expenses_status_idx
  on public.expenses (status);

create index if not exists expenses_category_id_idx
  on public.expenses (category_id)
  where category_id is not null;

create index if not exists expenses_paid_by_idx
  on public.expenses (paid_by)
  where paid_by is not null;

create index if not exists expense_attachments_expense_id_idx
  on public.expense_attachments (expense_id);
