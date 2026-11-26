-- DEKEZ document numbering, step 1 of 2: shared monthly counters plus a
-- new-style alias for every EXISTING document number.
--
-- New style: <PREFIX><YY><MM>-<NNN>, e.g. PV2611-001, DINV2611-001, JE2611-001.
-- The running number restarts at 001 every month, per prefix, based on the
-- document date. Numbers are handed out by one atomic upsert, so two users
-- posting at the same moment can never receive the same number, and a number
-- is never reused (voided documents keep theirs).
--
-- Existing numbers (DINV-2026-1161, JE-20261019-..., PV-20261030-..., DRI-2026-000004,
-- DKZ-FD80939D, ...) are NOT rewritten: they are printed on invoices already sent
-- to tenants, quoted on bank transfers and stored in audit records. Each one gets
-- a new-style alias in public.document_number_aliases so both stay searchable.
-- An alias table is used instead of an extra column because rent_bills and
-- accounting_journal_entries carry update triggers (archive queue, referral
-- credit, immutability guards) that must not fire for a numbering backfill.

create table if not exists public.document_number_counters (
  prefix text not null check (prefix ~ '^[A-Z]{1,6}$'),
  period_key text not null check (period_key ~ '^[0-9]{4}$'),
  last_number integer not null check (last_number > 0),
  updated_at timestamptz not null default now(),
  primary key (prefix, period_key)
);

alter table public.document_number_counters enable row level security;
revoke all on table public.document_number_counters from public, anon, authenticated;
grant select, insert, update on table public.document_number_counters to service_role;

create or replace function public.format_document_number(p_prefix text, p_date date, p_number integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select p_prefix || to_char(p_date, 'YYMM') || '-' ||
    case when p_number < 1000 then lpad(p_number::text, 3, '0') else p_number::text end;
$$;

create or replace function public.next_document_number(p_prefix text, p_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_value integer;
begin
  if p_prefix is null or p_prefix !~ '^[A-Z]{1,6}$' or p_date is null then
    raise exception 'document_number_details';
  end if;
  insert into public.document_number_counters as counters (prefix, period_key, last_number)
  values (p_prefix, to_char(p_date, 'YYMM'), 1)
  on conflict (prefix, period_key)
  do update set last_number = counters.last_number + 1, updated_at = now()
  returning counters.last_number into next_value;
  return public.format_document_number(p_prefix, p_date, next_value);
end;
$$;

revoke all on function public.next_document_number(text, date) from public, anon, authenticated;
grant execute on function public.next_document_number(text, date) to service_role;
revoke all on function public.format_document_number(text, date, integer) from public, anon;
grant execute on function public.format_document_number(text, date, integer) to service_role, authenticated;

comment on function public.next_document_number(text, date) is
  'Atomically issues the next <PREFIX><YYMM>-<NNN> number for the document date month. Never reuses a number.';

create table if not exists public.document_number_aliases (
  id uuid primary key default gen_random_uuid(),
  source_table text not null check (source_table in (
    'rent_bills', 'accounting_journal_entries', 'bank_payment_voucher',
    'renovation_documents', 'maintenance_tickets'
  )),
  source_id uuid,
  legacy_number text not null,
  new_number text not null unique,
  document_date date not null,
  created_at timestamptz not null default now(),
  unique (source_table, legacy_number)
);

create index if not exists document_number_aliases_source_idx
  on public.document_number_aliases (source_table, source_id);

alter table public.document_number_aliases enable row level security;
revoke all on table public.document_number_aliases from public, anon, authenticated;
grant select, insert on table public.document_number_aliases to service_role;
grant select on table public.document_number_aliases to authenticated;
-- Aliases only reveal document numbers; readable by accounting managers.
create policy "document_number_aliases_select_managers"
on public.document_number_aliases for select to authenticated
using ((select public.is_platform_admin()) or exists (
  select 1 from public.companies companies where public.can_manage_company(companies.id)
));

create or replace function public.protect_document_number_alias()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'document_number_alias_immutable';
end;
$$;

drop trigger if exists protect_document_number_alias on public.document_number_aliases;
create trigger protect_document_number_alias
before update or delete on public.document_number_aliases
for each row execute function public.protect_document_number_alias();

-- Legacy prefix -> new prefix. Journal entries keep their family letters
-- (JE-DM- deposit maintenance, JE-DF- deposit forfeit, HRC- historical credit).
create or replace function public.legacy_document_prefix(p_legacy text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_legacy ~ '^DINV-' then 'DINV'
    when p_legacy ~ '^JE-DM-' then 'JEDM'
    when p_legacy ~ '^JE-DF-' then 'JEDF'
    when p_legacy ~ '^JE-' then 'JE'
    when p_legacy ~ '^HRC-' then 'HRC'
    when p_legacy ~ '^PV-' then 'PV'
    when p_legacy ~ '^DRI-' then 'DRI'
    when p_legacy ~ '^DQ-' then 'DQ'
    when p_legacy ~ '^DKZ-' then 'DKZ'
    else null
  end;
$$;

-- Idempotent: only documents that are still old-style and have no alias get one.
-- Ordered by document date, then the old number, so aliases follow issue order.
create or replace function public.backfill_document_number_aliases()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  doc record;
  created integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('dekez:document_number_backfill', 0));
  for doc in
    select * from (
      select 'rent_bills'::text as source_table, b.id as source_id, b.invoice_number as legacy_number,
        b.bill_month::date as document_date
      from public.rent_bills b where b.invoice_number ~ '^DINV-'
      union all
      select 'accounting_journal_entries', j.id, j.entry_number, j.entry_date
      from public.accounting_journal_entries j where j.entry_number ~ '^(JE|HRC)-'
      union all
      select 'bank_payment_voucher', (array_agg(t.id order by t.created_at, t.id))[1], t.reference_number, min(t.transaction_date)
      from public.bank_manual_transactions t where t.reference_number ~ '^PV-[0-9]{8}-'
      group by t.reference_number
      union all
      select 'renovation_documents', r.id, r.document_number, r.document_date
      from public.renovation_documents r where r.document_number ~ '^(DQ|DRI)-'
      union all
      select 'maintenance_tickets', m.id, m.ticket_number, (m.created_at at time zone 'Asia/Kuala_Lumpur')::date
      from public.maintenance_tickets m where m.ticket_number ~ '^DKZ-[0-9A-F]{8}$'
    ) docs
    where not exists (
      select 1 from public.document_number_aliases a
      where a.source_table = docs.source_table and a.legacy_number = docs.legacy_number
    )
    order by public.legacy_document_prefix(docs.legacy_number), docs.document_date, docs.legacy_number
  loop
    insert into public.document_number_aliases (source_table, source_id, legacy_number, new_number, document_date)
    values (
      doc.source_table, doc.source_id, doc.legacy_number,
      public.next_document_number(public.legacy_document_prefix(doc.legacy_number), doc.document_date),
      doc.document_date
    );
    created := created + 1;
  end loop;
  return created;
end;
$$;

revoke all on function public.backfill_document_number_aliases() from public, anon, authenticated;
grant execute on function public.backfill_document_number_aliases() to service_role;

select public.backfill_document_number_aliases();
