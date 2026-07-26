alter table public.payment_submissions
  add column if not exists tenant_record_id uuid references public.tenant_records(id) on delete set null,
  alter column tenant_id drop not null;

alter table public.payment_attachments
  add column if not exists tenant_record_id uuid references public.tenant_records(id) on delete set null,
  alter column tenant_id drop not null;

alter table public.rent_reminder_logs
  add column if not exists tenant_record_id uuid references public.tenant_records(id) on delete set null,
  alter column tenant_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_submissions_has_tenant_source'
  ) then
    alter table public.payment_submissions
      add constraint payment_submissions_has_tenant_source
      check (tenant_id is not null or tenant_record_id is not null) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'payment_attachments_has_tenant_source'
  ) then
    alter table public.payment_attachments
      add constraint payment_attachments_has_tenant_source
      check (tenant_id is not null or tenant_record_id is not null) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'rent_reminder_logs_has_tenant_source'
  ) then
    alter table public.rent_reminder_logs
      add constraint rent_reminder_logs_has_tenant_source
      check (tenant_id is not null or tenant_record_id is not null) not valid;
  end if;
end
$$;

alter table public.payment_submissions
  validate constraint payment_submissions_has_tenant_source;

alter table public.payment_attachments
  validate constraint payment_attachments_has_tenant_source;

alter table public.rent_reminder_logs
  validate constraint rent_reminder_logs_has_tenant_source;

create index if not exists payment_submissions_tenant_record_idx
  on public.payment_submissions (tenant_record_id);

create index if not exists payment_attachments_tenant_record_idx
  on public.payment_attachments (tenant_record_id);

create index if not exists rent_reminder_logs_tenant_record_idx
  on public.rent_reminder_logs (tenant_record_id);
