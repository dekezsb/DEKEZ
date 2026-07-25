alter type public.bill_status add value if not exists 'upcoming';
alter type public.bill_status add value if not exists 'due_today';
alter type public.bill_status add value if not exists 'payment_submitted';
alter type public.bill_status add value if not exists 'pending_verification';
alter type public.bill_status add value if not exists 'partially_paid';
alter type public.bill_status add value if not exists 'waived';

alter table public.payments
  add column if not exists rent_bill_id uuid references public.rent_bills(id) on delete set null,
  add column if not exists verified_by uuid references auth.users(id) on delete set null,
  add column if not exists verified_at timestamptz;

create table if not exists public.rent_reminder_logs (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.rent_bills(id) on delete cascade,
  tenant_id uuid not null references auth.users(id) on delete cascade,
  reminder_stage text not null,
  channel text not null default 'whatsapp',
  sent_at timestamptz not null default now(),
  provider_message_id text,
  status text not null default 'sent',
  error_message text,
  created_by uuid references auth.users(id) on delete set null,
  unique (bill_id, reminder_stage, channel)
);

create table if not exists public.rent_bill_audit_logs (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.rent_bills(id) on delete cascade,
  action text not null,
  performed_by uuid references auth.users(id) on delete set null,
  performed_at timestamptz not null default now(),
  old_status text,
  new_status text not null,
  old_paid_amount numeric(12, 2),
  new_paid_amount numeric(12, 2),
  reason text
);

alter table public.rent_reminder_logs enable row level security;
alter table public.rent_bill_audit_logs enable row level security;

drop policy if exists "rent_reminder_logs_select_allowed" on public.rent_reminder_logs;
create policy "rent_reminder_logs_select_allowed" on public.rent_reminder_logs
for select using (
  public.is_platform_admin()
  or tenant_id = auth.uid()
  or exists (
    select 1 from public.rent_bills bills
    where bills.id = rent_reminder_logs.bill_id
      and public.can_access_property(bills.property_id)
  )
);

drop policy if exists "rent_reminder_logs_insert_admin" on public.rent_reminder_logs;
create policy "rent_reminder_logs_insert_admin" on public.rent_reminder_logs
for insert with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.rent_bills bills
    where bills.id = rent_reminder_logs.bill_id
      and public.can_access_property(bills.property_id)
  )
);

drop policy if exists "rent_bill_audit_logs_select_allowed" on public.rent_bill_audit_logs;
create policy "rent_bill_audit_logs_select_allowed" on public.rent_bill_audit_logs
for select using (
  public.is_platform_admin()
  or exists (
    select 1 from public.rent_bills bills
    where bills.id = rent_bill_audit_logs.bill_id
      and (
        bills.tenant_id = auth.uid()
        or public.can_access_property(bills.property_id)
      )
  )
);

drop policy if exists "rent_bill_audit_logs_insert_admin" on public.rent_bill_audit_logs;
create policy "rent_bill_audit_logs_insert_admin" on public.rent_bill_audit_logs
for insert with check (
  public.is_platform_admin()
  or exists (
    select 1 from public.rent_bills bills
    where bills.id = rent_bill_audit_logs.bill_id
      and public.can_access_property(bills.property_id)
  )
);
