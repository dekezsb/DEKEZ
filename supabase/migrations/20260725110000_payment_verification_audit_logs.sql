create table if not exists public.payment_verification_audit_logs (
  id uuid primary key default gen_random_uuid(),
  payment_submission_id uuid not null references public.payment_submissions(id) on delete cascade,
  action text not null check (action in ('verified', 'rejected', 'reversed')),
  performed_by uuid references auth.users(id) on delete set null,
  performed_at timestamptz not null default now(),
  old_status text,
  new_status text not null,
  reason text
);

alter table public.payment_verification_audit_logs enable row level security;

drop policy if exists "payment_verification_audit_select_admin" on public.payment_verification_audit_logs;
create policy "payment_verification_audit_select_admin" on public.payment_verification_audit_logs
for select using (public.is_platform_admin());

drop policy if exists "payment_verification_audit_insert_admin" on public.payment_verification_audit_logs;
create policy "payment_verification_audit_insert_admin" on public.payment_verification_audit_logs
for insert with check (public.is_platform_admin());
