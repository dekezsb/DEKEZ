-- DEKEZ Payment / Receipt / Journal Vouchers with AutoCount-style corrections.
--
-- * PV (payment voucher) and RV (receipt voucher) are numbered PV2611-001 /
--   RV2611-001 from public.next_document_number() and post a balanced journal
--   into the EXISTING accounting_journal_entries / accounting_journal_lines.
-- * Nothing posted is ever overwritten. "Edit" = automatic reversing journal
--   for the original (dated on the original date) + a new corrected posting
--   (revision 2, 3, ...) that keeps the same voucher number. "Void" = automatic
--   reversing journal + reason. The original and its reversal both stay in the
--   ledger with status 'posted', so every report nets them to zero.
-- * Manual journals and checkout deposit settlements become editable the same
--   way: on first edit they are adopted as a JV voucher.
-- * Payment vouchers recorded from Bank Reconciliation (bank_manual_transactions)
--   are editable/voidable with reversing rows, keeping the bank line reconciled.
-- * Every post / edit / void writes accounting_audit_logs with who, when,
--   before, after and reason.
-- * Conservative period rule: if the original or the new date is inside a
--   locked accounting period the change is refused (reopen the period first),
--   which matches AutoCount's behaviour for closed periods.

create table if not exists public.accounting_vouchers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  root_voucher_id uuid not null references public.accounting_vouchers(id) on delete restrict,
  revision integer not null default 1 check (revision >= 1),
  voucher_type text not null check (voucher_type in ('PV', 'RV', 'JV')),
  voucher_number text not null,
  voucher_date date not null,
  party_name text check (party_name is null or length(party_name) <= 160),
  property_id uuid references public.properties(id) on delete restrict,
  payment_account_id uuid references public.accounting_accounts(id) on delete restrict,
  reference_number text check (reference_number is null or length(reference_number) <= 100),
  description text not null check (length(btrim(description)) between 1 and 500),
  total_amount numeric(14, 2) not null check (total_amount > 0),
  status text not null default 'posted' check (status in ('posted', 'amended', 'voided')),
  origin text not null default 'voucher' check (origin in ('voucher', 'manual_journal', 'tenant_deposit_settlement')),
  journal_entry_id uuid not null unique references public.accounting_journal_entries(id) on delete restrict,
  reversal_journal_entry_id uuid unique references public.accounting_journal_entries(id) on delete restrict,
  amended_by_voucher_id uuid references public.accounting_vouchers(id) on delete restrict,
  change_reason text,
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (company_id, voucher_number, revision),
  check ((voucher_type = 'JV') = (payment_account_id is null))
);

create table if not exists public.accounting_voucher_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references public.accounting_vouchers(id) on delete restrict,
  line_no integer not null check (line_no between 1 and 100),
  account_id uuid not null references public.accounting_accounts(id) on delete restrict,
  property_id uuid references public.properties(id) on delete restrict,
  description text check (description is null or length(description) <= 300),
  debit numeric(14, 2) not null default 0 check (debit >= 0),
  credit numeric(14, 2) not null default 0 check (credit >= 0),
  unique (voucher_id, line_no),
  check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create index if not exists accounting_vouchers_company_date_idx
  on public.accounting_vouchers (company_id, voucher_date desc, voucher_number);
create index if not exists accounting_vouchers_root_idx
  on public.accounting_vouchers (root_voucher_id, revision);
create index if not exists accounting_voucher_lines_voucher_idx
  on public.accounting_voucher_lines (voucher_id);

alter table public.accounting_vouchers enable row level security;
alter table public.accounting_voucher_lines enable row level security;
revoke all on table public.accounting_vouchers, public.accounting_voucher_lines from public, anon, authenticated;
grant select, insert, update on table public.accounting_vouchers to service_role;
grant select, insert on table public.accounting_voucher_lines to service_role;
grant select on table public.accounting_vouchers, public.accounting_voucher_lines to authenticated;

-- Same read rule as the journal tables: company managers and platform admins.
create policy "accounting_vouchers_select_allowed"
on public.accounting_vouchers for select to authenticated
using ((select public.is_platform_admin()) or public.can_manage_company(company_id));

create policy "accounting_voucher_lines_select_allowed"
on public.accounting_voucher_lines for select to authenticated
using (
  exists (
    select 1 from public.accounting_vouchers vouchers
    where vouchers.id = accounting_voucher_lines.voucher_id
      and ((select public.is_platform_admin()) or public.can_manage_company(vouchers.company_id))
  )
);

-- Posted vouchers are immutable. Only the status transition posted -> amended /
-- voided (and its link/reason fields) is allowed, and only once.
create or replace function public.protect_accounting_voucher()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  mutable_fields text[] := array['status', 'reversal_journal_entry_id', 'amended_by_voucher_id', 'void_reason', 'voided_at', 'voided_by'];
begin
  if tg_table_name = 'accounting_voucher_lines' or tg_op = 'DELETE' then
    raise exception 'voucher_immutable';
  end if;
  if old.status <> 'posted' or new.status not in ('amended', 'voided')
    or (to_jsonb(new) - mutable_fields) is distinct from (to_jsonb(old) - mutable_fields) then
    raise exception 'voucher_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_accounting_voucher on public.accounting_vouchers;
create trigger protect_accounting_voucher before update or delete on public.accounting_vouchers
  for each row execute function public.protect_accounting_voucher();
drop trigger if exists protect_accounting_voucher_line on public.accounting_voucher_lines;
create trigger protect_accounting_voucher_line before update or delete on public.accounting_voucher_lines
  for each row execute function public.protect_accounting_voucher();

-- Journals behind vouchers, and every automatic reversal, can never be edited.
create or replace function public.protect_voucher_journal()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  entry_id uuid;
begin
  entry_id := case when tg_table_name = 'accounting_journal_lines'
    then (to_jsonb(old) ->> 'journal_entry_id')::uuid else (to_jsonb(old) ->> 'id')::uuid end;
  if exists (
    select 1 from public.accounting_journal_entries entries
    where entries.id = entry_id
      and entries.source_type in ('payment_voucher', 'receipt_voucher', 'journal_reversal')
  ) or exists (
    select 1 from public.accounting_vouchers vouchers
    where vouchers.journal_entry_id = entry_id or vouchers.reversal_journal_entry_id = entry_id
  ) then
    raise exception 'voucher_journal_immutable';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists protect_voucher_journal on public.accounting_journal_entries;
create trigger protect_voucher_journal before update or delete on public.accounting_journal_entries
  for each row execute function public.protect_voucher_journal();
drop trigger if exists protect_voucher_journal_line on public.accounting_journal_lines;
create trigger protect_voucher_journal_line before update or delete on public.accounting_journal_lines
  for each row execute function public.protect_voucher_journal();

revoke all on function public.protect_accounting_voucher() from public, anon, authenticated;
revoke all on function public.protect_voucher_journal() from public, anon, authenticated;

-- Bank reconciliation can match a bank line to a PV / RV (by its stable root id),
-- so a bank-paid voucher is not double counted by a second bank voucher.
alter table public.bank_reconciliation_matches
  drop constraint if exists bank_reconciliation_matches_source_type_check;
alter table public.bank_reconciliation_matches
  add constraint bank_reconciliation_matches_source_type_check check (
    source_type in (
      'payment', 'rent_bill', 'expense_payment_batch', 'staff_reimbursement_payout',
      'cash_bank_in', 'expense', 'manual_bank_transaction', 'bank_account_transfer',
      'accounting_voucher'
    )
  );

-- ---------------------------------------------------------------------------
-- Shared checks
-- ---------------------------------------------------------------------------
create or replace function public.assert_voucher_actor(p_company uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_company is null or p_actor is null then raise exception 'voucher_details'; end if;
  if not exists (
    select 1 from public.profiles profiles
    where profiles.id = p_actor and profiles.role::text in ('super_admin', 'admin')
  ) and not exists (
    select 1 from public.company_users company_users
    where company_users.company_id = p_company
      and coalesce(company_users.user_id, company_users.profile_id) = p_actor
      and company_users.status::text = 'active'
      and company_users.role::text in ('owner', 'admin', 'admin_team')
  ) then
    raise exception 'voucher_not_allowed';
  end if;
end;
$$;

create or replace function public.assert_voucher_period_open(p_company uuid, p_date date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.accounting_periods periods
    where periods.company_id = p_company and periods.status = 'locked'
      and p_date between periods.period_start and periods.period_end
  ) then
    raise exception 'voucher_period_locked';
  end if;
end;
$$;

create or replace function public.is_voucher_payment_account(p_company uuid, p_account uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.accounting_accounts accounts
    where accounts.id = p_account and accounts.company_id = p_company and accounts.is_active
      and (
        accounts.system_key in ('cash_on_hand', 'company_bank')
        or (accounts.account_type = 'asset' and accounts.code ~ '^10[0-9]{2}$')
        or exists (
          select 1 from public.bank_accounts banks
          where banks.company_id = p_company and banks.accounting_account_id = accounts.id and banks.is_active
        )
      )
  );
$$;

-- Validates detail lines and returns normalized voucher lines
-- [{line_no, account_id, property_id, description, debit, credit}].
-- PV/RV input lines: {account_id, property_id, description, amount}.
-- JV input lines:    {account_id, property_id, description, debit, credit}.
create or replace function public.normalize_voucher_lines(
  p_company uuid, p_type text, p_payment_account uuid, p_lines jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  item jsonb;
  result jsonb := '[]'::jsonb;
  position_value integer := 0;
  debit_value numeric;
  credit_value numeric;
  account_value uuid;
  property_value uuid;
  debit_total numeric := 0;
  credit_total numeric := 0;
begin
  if p_type not in ('PV', 'RV', 'JV') or jsonb_typeof(p_lines) is distinct from 'array' then
    raise exception 'voucher_details';
  end if;
  if jsonb_array_length(p_lines) < (case when p_type = 'JV' then 2 else 1 end) or jsonb_array_length(p_lines) > 100 then
    raise exception 'voucher_line_count';
  end if;
  for item in select value from jsonb_array_elements(p_lines) loop
    position_value := position_value + 1;
    begin
      account_value := nullif(item ->> 'account_id', '')::uuid;
      property_value := nullif(item ->> 'property_id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'voucher_invalid_line';
    end;
    if p_type = 'JV' then
      if coalesce(item ->> 'debit', '0') !~ '^[0-9]+(\.[0-9]{1,2})?$' or coalesce(item ->> 'credit', '0') !~ '^[0-9]+(\.[0-9]{1,2})?$' then
        raise exception 'voucher_amount';
      end if;
      debit_value := coalesce((item ->> 'debit')::numeric, 0);
      credit_value := coalesce((item ->> 'credit')::numeric, 0);
    else
      if coalesce(item ->> 'amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'voucher_amount'; end if;
      debit_value := case when p_type = 'PV' then (item ->> 'amount')::numeric else 0 end;
      credit_value := case when p_type = 'RV' then (item ->> 'amount')::numeric else 0 end;
    end if;
    if not ((debit_value > 0 and credit_value = 0) or (credit_value > 0 and debit_value = 0)) then
      raise exception 'voucher_invalid_line';
    end if;
    if account_value is null or not exists (
      select 1 from public.accounting_accounts accounts
      where accounts.id = account_value and accounts.company_id = p_company and accounts.is_active
    ) or (p_payment_account is not null and account_value = p_payment_account) then
      raise exception 'voucher_account';
    end if;
    if property_value is not null and not exists (
      select 1 from public.properties properties where properties.id = property_value and properties.company_id = p_company
    ) then
      raise exception 'voucher_property';
    end if;
    if length(coalesce(item ->> 'description', '')) > 300 then raise exception 'voucher_details'; end if;
    debit_total := debit_total + debit_value;
    credit_total := credit_total + credit_value;
    result := result || jsonb_build_array(jsonb_build_object(
      'line_no', position_value,
      'account_id', account_value,
      'property_id', property_value,
      'description', nullif(btrim(item ->> 'description'), ''),
      'debit', debit_value,
      'credit', credit_value
    ));
  end loop;
  if p_type = 'JV' and (debit_total <= 0 or debit_total <> credit_total) then
    raise exception 'voucher_not_balanced';
  end if;
  return result;
end;
$$;

-- Inserts one posted revision: journal entry + journal lines + voucher + lines.
create or replace function public.insert_voucher_revision(
  p_company uuid, p_actor uuid, p_type text, p_number text, p_revision integer, p_root uuid,
  p_date date, p_party text, p_property uuid, p_payment_account uuid, p_reference text,
  p_description text, p_lines jsonb, p_origin text, p_source_type text, p_source_id uuid, p_change_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  voucher_id uuid := gen_random_uuid();
  entry_id uuid := gen_random_uuid();
  normalized jsonb;
  total_value numeric;
begin
  if p_date is null or nullif(btrim(p_description), '') is null or length(p_description) > 500
    or length(coalesce(p_party, '')) > 160 or length(coalesce(p_reference, '')) > 100 then
    raise exception 'voucher_details';
  end if;
  if p_type in ('PV', 'RV') and (nullif(btrim(p_party), '') is null or p_payment_account is null
    or not public.is_voucher_payment_account(p_company, p_payment_account)) then
    raise exception 'voucher_payment_account';
  end if;
  if p_property is not null and not exists (
    select 1 from public.properties where id = p_property and company_id = p_company
  ) then
    raise exception 'voucher_property';
  end if;
  perform public.assert_voucher_period_open(p_company, p_date);
  normalized := public.normalize_voucher_lines(p_company, p_type, case when p_type = 'JV' then null else p_payment_account end, p_lines);
  select sum(case when p_type = 'RV' then (line ->> 'credit')::numeric else (line ->> 'debit')::numeric end)
  into total_value from jsonb_array_elements(normalized) line;

  insert into public.accounting_journal_entries (
    id, company_id, entry_date, entry_number, source_type, source_id, reference_number,
    description, status, posted_at, created_by
  ) values (
    entry_id, p_company, p_date,
    case when p_revision = 1 then p_number else p_number || '-R' || p_revision end,
    p_source_type, coalesce(p_source_id, voucher_id), nullif(btrim(p_reference), ''),
    case when p_type = 'JV' then btrim(p_description)
      else p_number || ' · ' || btrim(p_party) || ' · ' || btrim(p_description) end,
    'posted', now(), p_actor
  );

  insert into public.accounting_journal_lines (journal_entry_id, account_id, property_id, description, debit, credit)
  select entry_id, (line ->> 'account_id')::uuid, nullif(line ->> 'property_id', '')::uuid,
    line ->> 'description', (line ->> 'debit')::numeric, (line ->> 'credit')::numeric
  from jsonb_array_elements(normalized) line
  order by (line ->> 'line_no')::integer;

  if p_type in ('PV', 'RV') then
    insert into public.accounting_journal_lines (journal_entry_id, account_id, property_id, description, debit, credit)
    values (
      entry_id, p_payment_account, p_property,
      left(case when p_type = 'PV' then 'Paid to ' else 'Received from ' end || btrim(p_party), 300),
      case when p_type = 'RV' then total_value else 0 end,
      case when p_type = 'PV' then total_value else 0 end
    );
  end if;

  insert into public.accounting_vouchers (
    id, company_id, root_voucher_id, revision, voucher_type, voucher_number, voucher_date, party_name,
    property_id, payment_account_id, reference_number, description, total_amount, status, origin,
    journal_entry_id, change_reason, created_by
  ) values (
    voucher_id, p_company, coalesce(p_root, voucher_id), p_revision, p_type, p_number, p_date,
    nullif(btrim(p_party), ''), p_property, case when p_type = 'JV' then null else p_payment_account end,
    nullif(btrim(p_reference), ''), btrim(p_description), total_value, 'posted', p_origin,
    entry_id, p_change_reason, p_actor
  );

  insert into public.accounting_voucher_lines (voucher_id, line_no, account_id, property_id, description, debit, credit)
  select voucher_id, (line ->> 'line_no')::integer, (line ->> 'account_id')::uuid,
    nullif(line ->> 'property_id', '')::uuid, line ->> 'description',
    (line ->> 'debit')::numeric, (line ->> 'credit')::numeric
  from jsonb_array_elements(normalized) line;

  return voucher_id;
end;
$$;

create or replace function public.voucher_snapshot(p_voucher uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(v) || jsonb_build_object(
    'lines', coalesce((select jsonb_agg(to_jsonb(l) order by l.line_no) from public.accounting_voucher_lines l where l.voucher_id = v.id), '[]'::jsonb),
    'journal_entry_number', (select entry_number from public.accounting_journal_entries where id = v.journal_entry_id)
  )
  from public.accounting_vouchers v where v.id = p_voucher;
$$;

-- Posts the exact mirror of a journal (debits <-> credits), dated on the
-- original date so the corrected period shows the corrected figure.
create or replace function public.post_voucher_reversal(p_voucher public.accounting_vouchers, p_actor uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  reversal_id uuid := gen_random_uuid();
  original public.accounting_journal_entries%rowtype;
begin
  select * into strict original from public.accounting_journal_entries where id = p_voucher.journal_entry_id;
  insert into public.accounting_journal_entries (
    id, company_id, entry_date, entry_number, source_type, source_id, reference_number,
    description, status, reversed_entry_id, posted_at, created_by
  ) values (
    reversal_id, p_voucher.company_id, original.entry_date,
    p_voucher.voucher_number || '-REV' || p_voucher.revision,
    'journal_reversal', p_voucher.id, original.reference_number,
    left('Auto reversal of ' || original.entry_number || ': ' || btrim(p_reason), 500),
    'posted', original.id, now(), p_actor
  );
  insert into public.accounting_journal_lines (journal_entry_id, account_id, property_id, tenant_id, description, debit, credit)
  select reversal_id, lines.account_id, lines.property_id, lines.tenant_id,
    left('Reversal: ' || coalesce(lines.description, original.description), 300), lines.credit, lines.debit
  from public.accounting_journal_lines lines
  where lines.journal_entry_id = original.id;
  return reversal_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public RPCs (service role only; the app checks the user's session first)
-- ---------------------------------------------------------------------------
create or replace function public.post_accounting_voucher(
  p_company uuid, p_actor uuid, p_type text, p_date date, p_party text, p_property uuid,
  p_payment_account uuid, p_reference text, p_description text, p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  voucher_id uuid;
  number_value text;
begin
  perform public.assert_voucher_actor(p_company, p_actor);
  if p_type not in ('PV', 'RV', 'JV') or p_date is null then raise exception 'voucher_details'; end if;
  perform public.assert_voucher_period_open(p_company, p_date);
  number_value := public.next_document_number(p_type, p_date);
  voucher_id := public.insert_voucher_revision(
    p_company, p_actor, p_type, number_value, 1, null, p_date, p_party, p_property, p_payment_account,
    p_reference, p_description, p_lines,
    case when p_type = 'JV' then 'manual_journal' else 'voucher' end,
    case p_type when 'PV' then 'payment_voucher' when 'RV' then 'receipt_voucher' else 'manual_journal' end,
    null, null
  );
  insert into public.accounting_audit_logs (company_id, entity_type, entity_id, action, after_data, reason, performed_by)
  values (p_company, 'accounting_voucher', voucher_id, 'voucher_posted', public.voucher_snapshot(voucher_id),
    'Voucher ' || number_value || ' posted from DEKEZ Accounting.', p_actor);
  return voucher_id;
end;
$$;

-- Adopts an existing manual journal / deposit settlement as a JV voucher so it
-- can be edited or voided like any voucher. Idempotent.
create or replace function public.adopt_journal_entry_as_voucher(p_company uuid, p_actor uuid, p_entry uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry public.accounting_journal_entries%rowtype;
  voucher_id uuid;
  total_value numeric;
begin
  perform public.assert_voucher_actor(p_company, p_actor);
  select * into entry from public.accounting_journal_entries
  where id = p_entry and company_id = p_company for update;
  if not found then raise exception 'voucher_missing'; end if;
  select id into voucher_id from public.accounting_vouchers where journal_entry_id = p_entry;
  if voucher_id is not null then return voucher_id; end if;
  if entry.status <> 'posted' or entry.source_type not in ('manual_journal', 'tenant_deposit_settlement')
    or exists (select 1 from public.accounting_journal_entries r where r.reversed_entry_id = entry.id) then
    raise exception 'voucher_source_not_editable';
  end if;
  select sum(debit) into total_value from public.accounting_journal_lines where journal_entry_id = entry.id;
  if coalesce(total_value, 0) <= 0 then raise exception 'voucher_source_not_editable'; end if;
  voucher_id := gen_random_uuid();
  insert into public.accounting_vouchers (
    id, company_id, root_voucher_id, revision, voucher_type, voucher_number, voucher_date, description,
    reference_number, total_amount, status, origin, journal_entry_id, created_by, created_at
  ) values (
    voucher_id, p_company, voucher_id, 1, 'JV', entry.entry_number, entry.entry_date, entry.description,
    entry.reference_number, total_value, 'posted', entry.source_type, entry.id,
    coalesce(entry.created_by, p_actor), entry.created_at
  );
  insert into public.accounting_voucher_lines (voucher_id, line_no, account_id, property_id, description, debit, credit)
  select voucher_id, row_number() over (order by lines.created_at, lines.id), lines.account_id, lines.property_id,
    left(lines.description, 300), lines.debit, lines.credit
  from public.accounting_journal_lines lines where lines.journal_entry_id = entry.id;
  insert into public.accounting_audit_logs (company_id, entity_type, entity_id, action, after_data, reason, performed_by)
  values (p_company, 'accounting_voucher', voucher_id, 'journal_adopted_as_voucher', public.voucher_snapshot(voucher_id),
    'Existing journal ' || entry.entry_number || ' registered as a JV so it can be corrected with an audit trail.', p_actor);
  return voucher_id;
end;
$$;

create or replace function public.lock_current_voucher(p_company uuid, p_voucher uuid)
returns public.accounting_vouchers
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.accounting_vouchers%rowtype;
begin
  select * into current_row from public.accounting_vouchers
  where id = p_voucher and company_id = p_company for update;
  if not found then raise exception 'voucher_missing'; end if;
  if current_row.status <> 'posted' then raise exception 'voucher_already_changed'; end if;
  perform public.assert_voucher_period_open(p_company, current_row.voucher_date);
  return current_row;
end;
$$;

create or replace function public.amend_accounting_voucher(
  p_company uuid, p_actor uuid, p_voucher uuid, p_date date, p_party text, p_property uuid,
  p_payment_account uuid, p_reference text, p_description text, p_lines jsonb, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.accounting_vouchers%rowtype;
  original_entry public.accounting_journal_entries%rowtype;
  reversal_id uuid;
  new_id uuid;
  before_value jsonb;
  new_total numeric;
begin
  perform public.assert_voucher_actor(p_company, p_actor);
  if length(btrim(coalesce(p_reason, ''))) < 5 or length(p_reason) > 500 then raise exception 'voucher_reason_required'; end if;
  original := public.lock_current_voucher(p_company, p_voucher);
  perform public.assert_voucher_period_open(p_company, p_date);
  select * into strict original_entry from public.accounting_journal_entries where id = original.journal_entry_id;
  before_value := public.voucher_snapshot(original.id);

  reversal_id := public.post_voucher_reversal(original, p_actor, 'edited - ' || p_reason);
  new_id := public.insert_voucher_revision(
    p_company, p_actor, original.voucher_type, original.voucher_number, original.revision + 1, original.root_voucher_id,
    p_date, p_party, p_property, p_payment_account, p_reference, p_description, p_lines, original.origin,
    original_entry.source_type,
    case when original.origin = 'tenant_deposit_settlement' then original_entry.source_id else null end,
    btrim(p_reason)
  );
  update public.accounting_vouchers
  set status = 'amended', reversal_journal_entry_id = reversal_id, amended_by_voucher_id = new_id
  where id = original.id;

  -- A bank line matched to this PV/RV stays matched only if the bank side is unchanged.
  if exists (
    select 1 from public.bank_reconciliation_matches m
    where m.source_type = 'accounting_voucher' and m.source_id = original.root_voucher_id
  ) then
    select total_amount into new_total from public.accounting_vouchers where id = new_id;
    if new_total <> original.total_amount or p_payment_account is distinct from original.payment_account_id then
      raise exception 'voucher_bank_matched';
    end if;
  end if;

  insert into public.accounting_audit_logs (company_id, entity_type, entity_id, action, before_data, after_data, reason, performed_by)
  values (p_company, 'accounting_voucher', original.root_voucher_id, 'voucher_amended', before_value,
    public.voucher_snapshot(new_id) || jsonb_build_object('reversal_journal_entry_id', reversal_id), btrim(p_reason), p_actor);
  return new_id;
end;
$$;

create or replace function public.void_accounting_voucher(p_company uuid, p_actor uuid, p_voucher uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  original public.accounting_vouchers%rowtype;
  reversal_id uuid;
  before_value jsonb;
begin
  perform public.assert_voucher_actor(p_company, p_actor);
  if length(btrim(coalesce(p_reason, ''))) < 5 or length(p_reason) > 500 then raise exception 'voucher_reason_required'; end if;
  original := public.lock_current_voucher(p_company, p_voucher);
  if exists (
    select 1 from public.bank_reconciliation_matches m
    where m.source_type = 'accounting_voucher' and m.source_id = original.root_voucher_id
  ) then
    raise exception 'voucher_bank_matched';
  end if;
  before_value := public.voucher_snapshot(original.id);
  reversal_id := public.post_voucher_reversal(original, p_actor, 'voided - ' || p_reason);
  update public.accounting_vouchers
  set status = 'voided', reversal_journal_entry_id = reversal_id, void_reason = btrim(p_reason),
      voided_at = now(), voided_by = p_actor
  where id = original.id;
  insert into public.accounting_audit_logs (company_id, entity_type, entity_id, action, before_data, after_data, reason, performed_by)
  values (p_company, 'accounting_voucher', original.root_voucher_id, 'voucher_voided', before_value,
    public.voucher_snapshot(original.id) || jsonb_build_object('reversal_journal_entry_id', reversal_id), btrim(p_reason), p_actor);
  return reversal_id;
end;
$$;

create or replace function public.amend_journal_entry(
  p_company uuid, p_actor uuid, p_entry uuid, p_date date, p_reference text, p_description text,
  p_lines jsonb, p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  voucher_id uuid;
begin
  voucher_id := public.adopt_journal_entry_as_voucher(p_company, p_actor, p_entry);
  return public.amend_accounting_voucher(p_company, p_actor, voucher_id, p_date, null, null, null,
    p_reference, p_description, p_lines, p_reason);
end;
$$;

create or replace function public.void_journal_entry(p_company uuid, p_actor uuid, p_entry uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  voucher_id uuid;
begin
  voucher_id := public.adopt_journal_entry_as_voucher(p_company, p_actor, p_entry);
  return public.void_accounting_voucher(p_company, p_actor, voucher_id, p_reason);
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment vouchers recorded from Bank Reconciliation (bank_manual_transactions)
-- ---------------------------------------------------------------------------
alter table public.bank_manual_transactions
  add column if not exists voucher_revision integer not null default 1,
  add column if not exists reversal_of_id uuid references public.bank_manual_transactions(id) on delete restrict,
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_reason text;

create index if not exists bank_manual_transactions_reference_idx
  on public.bank_manual_transactions (company_id, reference_number);
create index if not exists bank_manual_transactions_reversal_idx
  on public.bank_manual_transactions (reversal_of_id) where reversal_of_id is not null;

-- Locks the current rows of one bank payment voucher and returns their ids.
create or replace function public.lock_bank_payment_voucher(p_company uuid, p_number text)
returns table (row_id uuid, statement_line_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  line_count integer;
begin
  perform 1 from public.bank_manual_transactions t
  where t.company_id = p_company and t.reference_number = p_number
    and t.superseded_at is null and t.reversal_of_id is null
  order by t.id for update;
  if not found then raise exception 'voucher_missing'; end if;
  if exists (
    select 1 from public.bank_manual_transactions t
    where t.company_id = p_company and t.reference_number = p_number and t.superseded_at is null and t.reversal_of_id is null
      and (t.amount >= 0 or exists (select 1 from public.renovation_payment_submissions s where s.bank_transaction_id = t.id)
        or exists (select 1 from public.accounting_journal_entries j where j.source_id = t.id and j.source_type = 'historical_rental_credit'))
  ) or (
    select count(distinct (t.bank_account_id, t.transaction_date)) from public.bank_manual_transactions t
    where t.company_id = p_company and t.reference_number = p_number and t.superseded_at is null and t.reversal_of_id is null
  ) <> 1 then
    raise exception 'voucher_source_not_editable';
  end if;
  select count(distinct m.statement_line_id) into line_count
  from public.bank_manual_transactions t
  join public.bank_reconciliation_matches m on m.source_type = 'manual_bank_transaction' and m.source_id = t.id
  where t.company_id = p_company and t.reference_number = p_number and t.superseded_at is null and t.reversal_of_id is null;
  if line_count > 1 then raise exception 'voucher_source_not_editable'; end if;
  return query
  select t.id, m.statement_line_id
  from public.bank_manual_transactions t
  left join public.bank_reconciliation_matches m on m.source_type = 'manual_bank_transaction' and m.source_id = t.id
  where t.company_id = p_company and t.reference_number = p_number and t.superseded_at is null and t.reversal_of_id is null;
end;
$$;

create or replace function public.reverse_bank_payment_voucher_rows(p_company uuid, p_actor uuid, p_number text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_value jsonb;
begin
  select jsonb_build_object(
    'voucher_number', p_number,
    'rows', jsonb_agg(to_jsonb(t) order by t.created_at, t.id),
    'matches', coalesce((
      select jsonb_agg(to_jsonb(m)) from public.bank_reconciliation_matches m
      where m.source_type = 'manual_bank_transaction' and m.source_id in (
        select x.id from public.bank_manual_transactions x
        where x.company_id = p_company and x.reference_number = p_number and x.superseded_at is null and x.reversal_of_id is null)
    ), '[]'::jsonb)
  ) into before_value
  from public.bank_manual_transactions t
  where t.company_id = p_company and t.reference_number = p_number and t.superseded_at is null and t.reversal_of_id is null;

  insert into public.bank_manual_transactions (
    company_id, bank_account_id, offset_account_id, property_id, transaction_date, amount, description,
    reference_number, created_by, voucher_revision, reversal_of_id, superseded_at, superseded_reason
  )
  select t.company_id, t.bank_account_id, t.offset_account_id, t.property_id, t.transaction_date, -t.amount,
    left('Auto reversal (' || p_number || ' rev ' || t.voucher_revision || '): ' || t.description, 500),
    t.reference_number, p_actor, t.voucher_revision, t.id, now(), btrim(p_reason)
  from public.bank_manual_transactions t
  where t.company_id = p_company and t.reference_number = p_number and t.superseded_at is null and t.reversal_of_id is null;

  delete from public.bank_reconciliation_matches m
  where m.source_type = 'manual_bank_transaction' and m.source_id in (
    select t.id from public.bank_manual_transactions t
    where t.company_id = p_company and t.reference_number = p_number and t.reversal_of_id is null and t.superseded_at is null);

  update public.bank_manual_transactions t
  set superseded_at = now(), superseded_reason = btrim(p_reason)
  where t.company_id = p_company and t.reference_number = p_number and t.superseded_at is null and t.reversal_of_id is null;
  return before_value;
end;
$$;

create or replace function public.amend_bank_payment_voucher(
  p_company uuid, p_actor uuid, p_number text, p_payee text, p_lines jsonb, p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_row public.bank_manual_transactions%rowtype;
  statement_line uuid;
  original_total numeric;
  new_total numeric := 0;
  next_revision integer;
  item jsonb;
  amount_value numeric;
  account_value uuid;
  property_value uuid;
  inserted_id uuid;
  before_value jsonb;
begin
  perform public.assert_voucher_actor(p_company, p_actor);
  if length(btrim(coalesce(p_reason, ''))) < 5 or length(p_reason) > 500 then raise exception 'voucher_reason_required'; end if;
  if nullif(btrim(p_payee), '') is null or length(p_payee) > 160 or jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'voucher_details';
  end if;
  select max(locked.statement_line_id::text)::uuid into statement_line from public.lock_bank_payment_voucher(p_company, p_number) locked;
  select * into current_row from public.bank_manual_transactions t
  where t.company_id = p_company and t.reference_number = p_number and t.superseded_at is null and t.reversal_of_id is null
  order by t.created_at, t.id limit 1;
  perform public.assert_voucher_period_open(p_company, current_row.transaction_date);
  select -sum(amount), max(voucher_revision) + 1 into original_total, next_revision
  from public.bank_manual_transactions t
  where t.company_id = p_company and t.reference_number = p_number and t.superseded_at is null and t.reversal_of_id is null;

  for item in select value from jsonb_array_elements(p_lines) loop
    if coalesce(item ->> 'amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'voucher_amount'; end if;
    amount_value := (item ->> 'amount')::numeric;
    begin
      account_value := (item ->> 'accountId')::uuid;
      property_value := nullif(nullif(item ->> 'propertyId', 'office'), '')::uuid;
    exception when invalid_text_representation then raise exception 'voucher_invalid_line';
    end;
    if amount_value <= 0 or nullif(btrim(item ->> 'description'), '') is null or length(item ->> 'description') > 300 then
      raise exception 'voucher_details';
    end if;
    if not exists (select 1 from public.accounting_accounts where id = account_value and company_id = p_company and is_active)
      or exists (select 1 from public.bank_accounts where id = current_row.bank_account_id and accounting_account_id = account_value) then
      raise exception 'voucher_account';
    end if;
    if property_value is not null and not exists (select 1 from public.properties where id = property_value and company_id = p_company) then
      raise exception 'voucher_property';
    end if;
    if property_value is null and exists (select 1 from public.accounting_accounts where id = account_value and system_key = 'property_rental_cost') then
      raise exception 'voucher_property_required';
    end if;
    new_total := new_total + amount_value;
  end loop;
  if new_total <> original_total then raise exception 'voucher_total'; end if;

  before_value := public.reverse_bank_payment_voucher_rows(p_company, p_actor, p_number, 'edited - ' || p_reason);

  for item in select value from jsonb_array_elements(p_lines) loop
    insert into public.bank_manual_transactions (
      company_id, bank_account_id, offset_account_id, property_id, transaction_date, amount, description,
      reference_number, created_by, voucher_revision
    ) values (
      p_company, current_row.bank_account_id, (item ->> 'accountId')::uuid,
      nullif(nullif(item ->> 'propertyId', 'office'), '')::uuid, current_row.transaction_date,
      -(item ->> 'amount')::numeric, btrim(p_payee) || ' · ' || btrim(item ->> 'description'),
      p_number, p_actor, next_revision
    ) returning id into inserted_id;
    if statement_line is not null then
      insert into public.bank_reconciliation_matches (statement_line_id, source_type, source_id, matched_amount, match_method, created_by)
      values (statement_line, 'manual_bank_transaction', inserted_id, -(item ->> 'amount')::numeric, 'adjustment', p_actor);
    end if;
  end loop;

  insert into public.accounting_audit_logs (company_id, entity_type, entity_id, action, before_data, after_data, reason, performed_by)
  values (p_company, 'bank_payment_voucher', current_row.id, 'bank_voucher_amended', before_value,
    jsonb_build_object('voucher_number', p_number, 'revision', next_revision, 'payee', btrim(p_payee),
      'lines', p_lines, 'total', new_total, 'statement_line_id', statement_line),
    btrim(p_reason), p_actor);
  return jsonb_build_object('voucher_number', p_number, 'revision', next_revision);
end;
$$;

create or replace function public.void_bank_payment_voucher(p_company uuid, p_actor uuid, p_number text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  statement_line uuid;
  current_row public.bank_manual_transactions%rowtype;
  before_value jsonb;
begin
  perform public.assert_voucher_actor(p_company, p_actor);
  if length(btrim(coalesce(p_reason, ''))) < 5 or length(p_reason) > 500 then raise exception 'voucher_reason_required'; end if;
  select max(locked.statement_line_id::text)::uuid into statement_line from public.lock_bank_payment_voucher(p_company, p_number) locked;
  select * into current_row from public.bank_manual_transactions t
  where t.company_id = p_company and t.reference_number = p_number and t.superseded_at is null and t.reversal_of_id is null
  order by t.created_at, t.id limit 1;
  perform public.assert_voucher_period_open(p_company, current_row.transaction_date);
  -- Voiding re-opens the bank line, so its statement must still be in progress.
  if statement_line is not null and not exists (
    select 1 from public.bank_statement_lines l
    join public.bank_statement_imports i on i.id = l.statement_import_id
    where l.id = statement_line and i.company_id = p_company and i.status = 'in_progress'
  ) then
    raise exception 'voucher_statement_closed';
  end if;
  before_value := public.reverse_bank_payment_voucher_rows(p_company, p_actor, p_number, 'voided - ' || p_reason);
  if statement_line is not null then
    update public.bank_statement_lines l
    set status = case
      when exists (select 1 from public.bank_reconciliation_matches m where m.statement_line_id = l.id) then l.status
      else 'unmatched' end,
      updated_at = now()
    where l.id = statement_line;
  end if;
  insert into public.accounting_audit_logs (company_id, entity_type, entity_id, action, before_data, after_data, reason, performed_by)
  values (p_company, 'bank_payment_voucher', current_row.id, 'bank_voucher_voided', before_value,
    jsonb_build_object('voucher_number', p_number, 'statement_line_id', statement_line, 'status', 'voided'),
    btrim(p_reason), p_actor);
  return jsonb_build_object('voucher_number', p_number, 'statement_line_id', statement_line);
end;
$$;

do $grants$
declare
  signature text;
begin
  foreach signature in array array[
    'public.assert_voucher_actor(uuid,uuid)',
    'public.assert_voucher_period_open(uuid,date)',
    'public.is_voucher_payment_account(uuid,uuid)',
    'public.normalize_voucher_lines(uuid,text,uuid,jsonb)',
    'public.insert_voucher_revision(uuid,uuid,text,text,integer,uuid,date,text,uuid,uuid,text,text,jsonb,text,text,uuid,text)',
    'public.voucher_snapshot(uuid)',
    'public.post_voucher_reversal(public.accounting_vouchers,uuid,text)',
    'public.post_accounting_voucher(uuid,uuid,text,date,text,uuid,uuid,text,text,jsonb)',
    'public.adopt_journal_entry_as_voucher(uuid,uuid,uuid)',
    'public.lock_current_voucher(uuid,uuid)',
    'public.amend_accounting_voucher(uuid,uuid,uuid,date,text,uuid,uuid,text,text,jsonb,text)',
    'public.void_accounting_voucher(uuid,uuid,uuid,text)',
    'public.amend_journal_entry(uuid,uuid,uuid,date,text,text,jsonb,text)',
    'public.void_journal_entry(uuid,uuid,uuid,text)',
    'public.lock_bank_payment_voucher(uuid,text)',
    'public.reverse_bank_payment_voucher_rows(uuid,uuid,text,text)',
    'public.amend_bank_payment_voucher(uuid,uuid,text,text,jsonb,text)',
    'public.void_bank_payment_voucher(uuid,uuid,text,text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', signature);
    execute format('grant execute on function %s to service_role', signature);
  end loop;
end;
$grants$;
