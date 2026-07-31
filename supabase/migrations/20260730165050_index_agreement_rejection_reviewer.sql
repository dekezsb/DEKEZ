create index if not exists tenancy_agreements_admin_rejected_by_idx
  on public.tenancy_agreements (admin_rejected_by)
  where admin_rejected_by is not null;
