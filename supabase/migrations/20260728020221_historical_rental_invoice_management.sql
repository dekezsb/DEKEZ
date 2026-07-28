alter table public.rent_bills
  add column if not exists invoice_date date,
  add column if not exists invoice_source text not null default 'automatic',
  add column if not exists notes text,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references auth.users(id) on delete set null,
  add column if not exists removal_reason text;

update public.rent_bills
set invoice_date = due_date
where invoice_date is null;

alter table public.rent_bills
  alter column invoice_date set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.rent_bills'::regclass
      and conname = 'rent_bills_invoice_source_check'
  ) then
    alter table public.rent_bills
      add constraint rent_bills_invoice_source_check
      check (invoice_source in ('automatic', 'manual_historical'));
  end if;
end
$$;

create table if not exists public.rental_invoice_audit_logs (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid,
  invoice_number text not null,
  organization_id uuid,
  property_id uuid,
  room_id uuid,
  tenant_id uuid,
  tenant_record_id uuid,
  action text not null
    check (action in ('manual_created', 'deleted', 'voided')),
  performed_by uuid,
  performed_at timestamptz not null default now(),
  reason text,
  original_invoice jsonb not null
);

create index if not exists rental_invoice_audit_invoice_id_idx
  on public.rental_invoice_audit_logs (invoice_id);

create index if not exists rental_invoice_audit_property_date_idx
  on public.rental_invoice_audit_logs (property_id, performed_at desc);

alter table public.rental_invoice_audit_logs enable row level security;

drop policy if exists "rental_invoice_audit_select_admin"
  on public.rental_invoice_audit_logs;
create policy "rental_invoice_audit_select_admin"
on public.rental_invoice_audit_logs
for select
to authenticated
using ((select public.is_platform_admin()));

grant select on public.rental_invoice_audit_logs to authenticated;
grant all on public.rental_invoice_audit_logs to service_role;

create or replace function public.set_rental_invoice_metadata()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  running_number bigint;
begin
  if tg_op = 'UPDATE' then
    new.invoice_number := old.invoice_number;
    new.invoice_date := old.invoice_date;
    new.issued_at := old.issued_at;
    new.retain_until := greatest(old.retain_until, new.retain_until);
    return new;
  end if;

  if new.invoice_number is null or btrim(new.invoice_number) = '' then
    running_number := nextval('public.rental_invoice_number_seq');
    new.invoice_number :=
      'DINV-' ||
      extract(year from new.bill_month)::integer::text ||
      '-' ||
      lpad(running_number::text, 4, '0');
  end if;

  new.invoice_date := coalesce(new.invoice_date, new.due_date, new.bill_month);
  new.issued_at := (
    new.invoice_date::timestamp at time zone 'Asia/Kuala_Lumpur'
  );
  new.retain_until := coalesce(
    new.retain_until,
    (new.invoice_date + interval '7 years')::date
  );
  return new;
end;
$$;

drop trigger if exists rent_bills_invoice_metadata on public.rent_bills;
create trigger rent_bills_invoice_metadata
before insert or update of
  bill_month,
  invoice_number,
  invoice_date,
  issued_at,
  retain_until
on public.rent_bills
for each row
execute function public.set_rental_invoice_metadata();

revoke execute on function public.set_rental_invoice_metadata()
  from public, anon, authenticated;

create or replace function public.audit_manual_rental_invoice_creation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.invoice_source = 'manual_historical' then
    insert into public.rental_invoice_audit_logs (
      invoice_id,
      invoice_number,
      organization_id,
      property_id,
      room_id,
      tenant_id,
      tenant_record_id,
      action,
      performed_by,
      reason,
      original_invoice
    )
    values (
      new.id,
      new.invoice_number,
      new.organization_id,
      new.property_id,
      new.room_id,
      new.tenant_id,
      new.tenant_record_id,
      'manual_created',
      new.created_by,
      null,
      to_jsonb(new)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists rent_bills_audit_manual_creation on public.rent_bills;
create trigger rent_bills_audit_manual_creation
after insert on public.rent_bills
for each row
execute function public.audit_manual_rental_invoice_creation();

revoke execute on function public.audit_manual_rental_invoice_creation()
  from public, anon, authenticated;

create or replace function public.prevent_rental_invoice_early_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if
    old.status = 'draft'
    and coalesce(old.paid_amount, 0) = 0
    and current_setting('dekez.allow_draft_invoice_delete', true) = 'on'
  then
    return old;
  end if;

  raise exception
    'Rental invoice % cannot be permanently deleted. Void it instead.',
    old.invoice_number;
end;
$$;

drop trigger if exists rent_bills_prevent_early_delete on public.rent_bills;
create trigger rent_bills_prevent_early_delete
before delete on public.rent_bills
for each row
execute function public.prevent_rental_invoice_early_delete();

revoke execute on function public.prevent_rental_invoice_early_delete()
  from public, anon, authenticated;

create or replace function public.remove_rental_invoice(
  target_invoice_id uuid,
  removal_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  invoice public.rent_bills%rowtype;
  has_related_history boolean := false;
  action_name text;
begin
  if actor_id is null or not public.is_platform_admin() then
    raise exception 'Only an authorised Admin can remove rental invoices.';
  end if;

  if nullif(btrim(removal_reason), '') is null then
    raise exception 'A removal reason is required.';
  end if;

  select *
  into invoice
  from public.rent_bills
  where id = target_invoice_id
  for update;

  if not found then
    raise exception 'Rental invoice was not found.';
  end if;

  if invoice.status = 'cancelled' then
    raise exception 'Rental invoice % is already cancelled.', invoice.invoice_number;
  end if;

  select
    exists (
      select 1
      from public.payments payment
      where payment.rent_bill_id = invoice.id
    )
    or exists (
      select 1
      from public.payment_submissions submission
      where submission.rent_bill_id = invoice.id
    )
    or exists (
      select 1
      from public.rent_reminder_logs reminder
      where reminder.bill_id = invoice.id
    )
    or exists (
      select 1
      from public.rent_bill_audit_logs bill_audit
      where bill_audit.bill_id = invoice.id
    )
  into has_related_history;

  action_name :=
    case
      when
        invoice.status = 'draft'
        and coalesce(invoice.paid_amount, 0) = 0
        and not has_related_history
      then 'deleted'
      else 'voided'
    end;

  insert into public.rental_invoice_audit_logs (
    invoice_id,
    invoice_number,
    organization_id,
    property_id,
    room_id,
    tenant_id,
    tenant_record_id,
    action,
    performed_by,
    reason,
    original_invoice
  )
  values (
    invoice.id,
    invoice.invoice_number,
    invoice.organization_id,
    invoice.property_id,
    invoice.room_id,
    invoice.tenant_id,
    invoice.tenant_record_id,
    action_name,
    actor_id,
    btrim(removal_reason),
    to_jsonb(invoice)
  );

  if action_name = 'deleted' then
    perform set_config('dekez.allow_draft_invoice_delete', 'on', true);
    delete from public.rent_bills where id = invoice.id;
  else
    update public.rent_bills
    set
      status = 'cancelled',
      removed_at = now(),
      removed_by = actor_id,
      removal_reason = btrim(removal_reason),
      updated_at = now()
    where id = invoice.id;
  end if;

  return action_name;
end;
$$;

revoke all on function public.remove_rental_invoice(uuid, text)
  from public, anon;
grant execute on function public.remove_rental_invoice(uuid, text)
  to authenticated;
