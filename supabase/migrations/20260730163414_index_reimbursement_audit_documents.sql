create index if not exists staff_reimbursement_payouts_recorded_by_idx
  on public.staff_reimbursement_payouts (recorded_by);

create index if not exists claim_attachments_claim_id_idx
  on public.claim_attachments (claim_id);

create index if not exists claim_attachments_uploaded_by_idx
  on public.claim_attachments (uploaded_by);

create index if not exists expense_attachments_uploaded_by_idx
  on public.expense_attachments (uploaded_by);
