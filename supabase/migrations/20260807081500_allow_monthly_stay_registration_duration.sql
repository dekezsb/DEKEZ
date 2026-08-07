alter table public.tenant_applications
  drop constraint if exists tenant_applications_contract_duration_months_check;

alter table public.tenant_applications
  add constraint tenant_applications_contract_duration_months_check
  check (contract_duration_months in (1, 6, 12));

comment on column public.tenant_applications.contract_duration_months is
  'One month represents a rolling monthly-stay registration; six and twelve months represent fixed tenancy terms.';
