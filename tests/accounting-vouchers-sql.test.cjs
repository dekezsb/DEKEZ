const { PGlite } = require('@electric-sql/pglite');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const read = (name) => fs.readFileSync(`supabase/migrations/${name}`, 'utf8');
const foundation = read('20260805090954_accounting_pnl_bank_reconciliation.sql').split('create table if not exists public.bank_accounts')[0];
const journal = read('20260814155906_post_manual_journal_entries.sql');
const bankVoucher = read('20260914075535_payment_voucher_decimal_amounts.sql');
const aliases = read('20261127090000_document_numbering_aliases.sql');
const newStyle = read('20261127090100_document_numbering_new_style.sql');
const vouchers = read('20261127090200_accounting_vouchers.sql');
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const COMPANY = id(1), ADMIN = id(3), TENANT = id(4), PROPERTY = id(5);
const BANK_GL = id(10), CASH = id(11), REPAIRS = id(12), RENT_INCOME = id(13), OTHER_INCOME = id(14), PAYABLE = id(15), BANK = id(20);
let db;
const rows = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await rows(sql, params))[0];
const rejects = async (promise, pattern) => assert.rejects(promise, (error) => pattern.test(error.message));

test.before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function is_platform_admin() returns boolean language sql as 'select false'; create function can_manage_company(uuid) returns boolean language sql as 'select false';
    create table companies(id uuid primary key); create table profiles(id uuid primary key, role text);
    create table company_users(company_id uuid, user_id uuid, profile_id uuid, status text, role text);
    create table properties(id uuid primary key, company_id uuid, name text);
    ${foundation}
    create table bank_accounts(id uuid primary key, company_id uuid, accounting_account_id uuid, is_active boolean default true);
    create table bank_statement_imports(id uuid primary key, company_id uuid, status text, period_start date default '2026-11-01');
    create table bank_statement_lines(id uuid primary key, bank_account_id uuid, statement_import_id uuid, transaction_date date, reference_number text, amount numeric, status text, updated_at timestamptz);
    create table bank_manual_transactions(id uuid primary key default gen_random_uuid(), company_id uuid, bank_account_id uuid, offset_account_id uuid, property_id uuid, transaction_date date, amount numeric, description text, reference_number text, attachment_bucket_name text, attachment_file_path text, created_by uuid, created_at timestamptz default clock_timestamp());
    create table bank_reconciliation_matches(id uuid primary key default gen_random_uuid(), statement_line_id uuid, source_type text, source_id uuid, matched_amount numeric, match_method text, created_by uuid, unique(statement_line_id, source_type, source_id));
    create table accounting_audit_logs(id uuid primary key default gen_random_uuid(), company_id uuid, entity_type text, entity_id uuid, action text, before_data jsonb, after_data jsonb, reason text, performed_by uuid, performed_at timestamptz default now());
    create table renovation_payment_submissions(id uuid primary key, bank_transaction_id uuid, status text);
    create table renovation_documents(id uuid primary key, document_number text, document_date date);
    create table maintenance_tickets(id uuid primary key default gen_random_uuid(), ticket_number text not null unique default ('DKZ-' || upper(substr(gen_random_uuid()::text, 1, 8))), created_at timestamptz not null default now());
    create sequence rental_invoice_number_seq;
    create table rent_bills(id uuid primary key default gen_random_uuid(), bill_month date, due_date date, invoice_number text, invoice_date date, issued_at timestamptz, retain_until date);
    create function set_rental_invoice_metadata() returns trigger language plpgsql as $$ begin
      if new.invoice_number is null then new.invoice_number := 'DINV-' || extract(year from new.bill_month)::integer::text || '-' || lpad(nextval('rental_invoice_number_seq')::text, 4, '0'); end if;
      return new; end $$;
    create trigger rent_bills_invoice_metadata before insert or update on rent_bills for each row execute function set_rental_invoice_metadata();
    -- Stubs with the exact live number expressions the switch migration rewrites.
    create function public.issue_renovation_document_base(p_company uuid,p_actor uuid,p_id uuid,p_version integer,p_a text,p_b text,p_c date,p_d date) returns text language plpgsql as $f$
    declare v_date date := p_c; v_number text; begin
      if p_a = 'quote' then v_number := 'DQ-' || to_char(v_date,'YYYY') || '-' || lpad(nextval('public.renovation_quote_number_seq')::text,6,'0');
      else v_number := 'DRI-' || to_char(v_date,'YYYY') || '-' || lpad(nextval('public.renovation_invoice_number_seq')::text,6,'0'); end if;
      return v_number; end $f$;
    create sequence renovation_quote_number_seq; create sequence renovation_invoice_number_seq;
    create function public.clear_historical_rental_credits(p_company uuid,p_bank uuid,p_actor uuid,p_run uuid,p_hash text) returns text language plpgsql as $f$
    declare journal uuid := gen_random_uuid(); current_day date := date '2026-11-20'; begin return 'HRC-'||journal::text; end $f$;
    ${journal}
    ${bankVoucher}`);
  // Legacy data that must get aliases (not rewritten).
  await db.exec(`insert into companies values('${COMPANY}');
    insert into auth.users values('${ADMIN}'),('${TENANT}');
    insert into profiles values('${ADMIN}','super_admin'),('${TENANT}','tenant');
    insert into properties values('${PROPERTY}','${COMPANY}','Hilltop');
    insert into accounting_accounts(id,company_id,code,name,account_type,report_group,normal_balance,system_key) values
      ('${BANK_GL}','${COMPANY}','1011','Dekez Sdn Bhd','asset','current_asset','debit',null),
      ('${CASH}','${COMPANY}','1000','Cash on Hand','asset','current_asset','debit','cash_on_hand'),
      ('${REPAIRS}','${COMPANY}','5200','Repairs','expense','operating_expense','debit',null),
      ('${RENT_INCOME}','${COMPANY}','4000','Rental Income','income','revenue','credit',null),
      ('${OTHER_INCOME}','${COMPANY}','4190','Other Tenant Charges Income','income','other_income','credit',null),
      ('${PAYABLE}','${COMPANY}','2000','Accounts Payable','liability','current_liability','credit','accounts_payable');
    insert into bank_accounts values('${BANK}','${COMPANY}','${BANK_GL}',true);
    insert into rent_bills(bill_month) values('2026-10-01'),('2026-10-01'),('2026-11-01');
    insert into renovation_documents values('${id(40)}','DRI-2026-000004','2026-10-19');
    insert into maintenance_tickets(created_at) values('2026-11-02T02:00:00Z');
    insert into bank_manual_transactions(company_id,bank_account_id,offset_account_id,transaction_date,amount,description,reference_number,created_by) values
      ('${COMPANY}','${BANK}','${REPAIRS}','2026-10-30',-50,'Old voucher · a','PV-20261030-AAAA','${ADMIN}'),
      ('${COMPANY}','${BANK}','${REPAIRS}','2026-10-30',-25,'Old voucher · b','PV-20261030-AAAA','${ADMIN}');`);
  await db.query('select post_manual_journal_entry($1,$2,$3,$4,$5,$6)', [COMPANY, '2026-09-30', null, 'PAYROLL SEPT 2026',
    JSON.stringify([{ account_id: REPAIRS, debit: 100, credit: 0 }, { account_id: PAYABLE, debit: 0, credit: 100 }]), ADMIN]);
  await db.exec(aliases);
  await db.exec(newStyle);
  await db.exec(vouchers);
});
test.after(async () => db?.close());

const trialBalance = async () => Object.fromEntries((await rows(`select a.code, sum(l.debit - l.credit)::numeric(14,2)::text as net
  from accounting_journal_lines l join accounting_journal_entries e on e.id = l.journal_entry_id join accounting_accounts a on a.id = l.account_id
  where e.status = 'posted' group by a.code order by a.code`)).map((r) => [r.code, r.net]));

const postVoucher = (type, lines, extra = {}) => one(`select post_accounting_voucher($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as id`, [
  COMPANY, extra.actor ?? ADMIN, type, extra.date ?? '2026-11-05', extra.party ?? 'Ah Seng Hardware', extra.property ?? PROPERTY,
  type === 'JV' ? null : extra.payment ?? BANK_GL, extra.reference ?? 'CHQ 1001', extra.description ?? 'Aircond repair', JSON.stringify(lines)]);

test('existing numbers get new-style aliases without being rewritten', async () => {
  const aliasRows = await rows('select source_table, legacy_number, new_number from document_number_aliases order by new_number');
  const byLegacy = Object.fromEntries(aliasRows.map((r) => [r.legacy_number, r.new_number]));
  assert.equal(byLegacy['DINV-2026-0001'], 'DINV2610-001');
  assert.equal(byLegacy['DINV-2026-0002'], 'DINV2610-002');
  assert.equal(byLegacy['DINV-2026-0003'], 'DINV2611-001');
  assert.equal(byLegacy['DRI-2026-000004'], 'DRI2610-001');
  assert.equal(byLegacy['PV-20261030-AAAA'], 'PV2610-001');
  assert.ok(Object.keys(byLegacy).some((legacy) => /^JE-20260930-/.test(legacy)));
  assert.ok(aliasRows.some((r) => r.new_number === 'JE2609-001'));
  assert.ok(aliasRows.some((r) => r.new_number === 'DKZ2611-001'));
  const invoices = await rows('select invoice_number from rent_bills order by invoice_number');
  assert.deepEqual(invoices.map((r) => r.invoice_number), ['DINV-2026-0001', 'DINV-2026-0002', 'DINV-2026-0003']);
  assert.equal(await one('select backfill_document_number_aliases() as n').then((r) => r.n), 0, 'backfill is idempotent');
  await rejects(db.query(`update document_number_aliases set new_number='X'`), /document_number_alias_immutable/);
});

test('new documents use PREFIX YYMM-NNN, continue after legacy aliases and restart monthly', async () => {
  await db.exec(`insert into rent_bills(bill_month) values('2026-11-01'),('2026-12-01')`);
  const invoices = (await rows('select invoice_number from rent_bills order by invoice_number')).map((r) => r.invoice_number);
  assert.ok(invoices.includes('DINV2611-002'), invoices.join());
  assert.ok(invoices.includes('DINV2612-001'));
  const journalId = (await one('select post_manual_journal_entry($1,$2,$3,$4,$5,$6) as id', [COMPANY, '2026-11-10', null, 'Accrual',
    JSON.stringify([{ account_id: REPAIRS, debit: 10, credit: 0 }, { account_id: PAYABLE, debit: 0, credit: 10 }]), ADMIN])).id;
  assert.equal((await one('select entry_number from accounting_journal_entries where id=$1', [journalId])).entry_number, 'JE2611-001');
  assert.equal((await one(`select issue_renovation_document_base($1,$2,$3,1,'quote',null,'2026-11-03',null) as n`, [COMPANY, ADMIN, id(41)])).n, 'DQ2611-001');
  assert.equal((await one(`select issue_renovation_document_base($1,$2,$3,1,'invoice',null,'2026-11-03',null) as n`, [COMPANY, ADMIN, id(41)])).n, 'DRI2611-001');
  assert.equal((await one(`select clear_historical_rental_credits($1,$2,$3,$4,'x') as n`, [COMPANY, BANK, ADMIN, id(42)])).n, 'HRC2611-001');
  await db.exec(`insert into maintenance_tickets default values`);
  assert.ok((await rows('select ticket_number from maintenance_tickets')).some((r) => /^DKZ\d{4}-\d{3}$/.test(r.ticket_number)));
  const numbers = await Promise.all(Array.from({ length: 20 }, () => one(`select next_document_number('RV', '2027-01-15') as n`)));
  assert.equal(new Set(numbers.map((r) => r.n)).size, 20, 'no duplicates');
  assert.equal((await one(`select format_document_number('PV', '2026-11-01', 1234) as n`)).n, 'PV2611-1234');
});

test('PV and RV post balanced journals with monthly PV/RV numbers', async () => {
  const before = await trialBalance();
  const pv = (await postVoucher('PV', [{ account_id: REPAIRS, property_id: PROPERTY, description: 'Compressor', amount: '300.50' }, { account_id: REPAIRS, description: 'Gas', amount: '49.50' }])).id;
  const rv = (await postVoucher('RV', [{ account_id: OTHER_INCOME, property_id: PROPERTY, description: 'Lost key', amount: '50' }], { party: 'Tenant HLT 2', payment: CASH })).id;
  const pvRow = await one('select * from accounting_vouchers where id=$1', [pv]);
  const rvRow = await one('select * from accounting_vouchers where id=$1', [rv]);
  assert.match(pvRow.voucher_number, /^PV2611-\d{3}$/);
  assert.equal(rvRow.voucher_number, 'RV2611-001');
  assert.equal(pvRow.total_amount, '350.00');
  const lines = await rows('select debit, credit from accounting_journal_lines where journal_entry_id=$1', [pvRow.journal_entry_id]);
  assert.equal(lines.reduce((t, l) => t + Number(l.debit), 0), 350);
  assert.equal(lines.reduce((t, l) => t + Number(l.credit), 0), 350);
  const after = await trialBalance();
  assert.equal(Number(after['5200']) - Number(before['5200'] ?? 0), 350);
  assert.equal(Number(after['1011'] ?? 0) - Number(before['1011'] ?? 0), -350);
  assert.equal(Number(after['1000'] ?? 0) - Number(before['1000'] ?? 0), 50);
  assert.equal((await one(`select count(*)::int as n from accounting_audit_logs where action='voucher_posted'`)).n, 2);
});

test('voucher validation refuses bad input and non-admins', async () => {
  await rejects(postVoucher('PV', [{ account_id: REPAIRS, amount: '10' }], { actor: TENANT }), /voucher_not_allowed/);
  await rejects(postVoucher('PV', [{ account_id: REPAIRS, amount: '10.123' }]), /voucher_amount/);
  await rejects(postVoucher('PV', [{ account_id: BANK_GL, amount: '10' }]), /voucher_account/);
  await rejects(postVoucher('PV', [{ account_id: REPAIRS, amount: '10' }], { payment: REPAIRS }), /voucher_payment_account/);
  await rejects(postVoucher('JV', [{ account_id: REPAIRS, debit: '10', credit: '0' }, { account_id: PAYABLE, debit: '0', credit: '9' }]), /voucher_not_balanced/);
  await db.exec(`insert into accounting_periods(company_id,period_start,period_end,status) values('${COMPANY}','2026-08-01','2026-08-31','locked')`);
  await rejects(postVoucher('PV', [{ account_id: REPAIRS, amount: '10' }], { date: '2026-08-15' }), /voucher_period_locked/);
});

test('edit reverses the original, reposts the correction, keeps the number and nets to zero', async () => {
  const pv = (await postVoucher('PV', [{ account_id: REPAIRS, description: 'Paint', amount: '200' }], { description: 'Paint job' })).id;
  const original = await one('select * from accounting_vouchers where id=$1', [pv]);
  const before = await trialBalance();
  await rejects(db.query('select amend_accounting_voucher($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [COMPANY, ADMIN, pv, '2026-11-06', 'Ah Seng', PROPERTY, BANK_GL, null, 'Paint job', JSON.stringify([{ account_id: REPAIRS, amount: '180' }]), '']), /voucher_reason_required/);
  const amended = (await one('select amend_accounting_voucher($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as id', [COMPANY, ADMIN, pv, '2026-11-06', 'Ah Seng', PROPERTY, BANK_GL, null, 'Paint job', JSON.stringify([{ account_id: REPAIRS, amount: '180' }]), 'Supplier gave RM20 discount'])).id;
  const oldRow = await one('select * from accounting_vouchers where id=$1', [pv]);
  const newRow = await one('select * from accounting_vouchers where id=$1', [amended]);
  assert.equal(oldRow.status, 'amended');
  assert.equal(newRow.status, 'posted');
  assert.equal(newRow.voucher_number, original.voucher_number);
  assert.equal(newRow.revision, 2);
  assert.equal(newRow.root_voucher_id, pv);
  const reversal = await one('select * from accounting_journal_entries where id=$1', [oldRow.reversal_journal_entry_id]);
  assert.equal(reversal.reversed_entry_id, original.journal_entry_id);
  assert.equal(reversal.entry_number, `${original.voucher_number}-REV1`);
  assert.equal(reversal.entry_date.toISOString().slice(0, 10), '2026-11-05');
  assert.equal((await one('select entry_number from accounting_journal_entries where id=$1', [newRow.journal_entry_id])).entry_number, `${original.voucher_number}-R2`);
  const after = await trialBalance();
  assert.equal(Number(after['5200']) - Number(before['5200']), -20, 'only the RM20 difference remains');
  assert.equal(Number(after['1011']) - Number(before['1011']), 20);
  const audit = await one(`select * from accounting_audit_logs where action='voucher_amended' and entity_id=$1`, [pv]);
  assert.equal(audit.reason, 'Supplier gave RM20 discount');
  assert.equal(audit.before_data.total_amount, 200);
  assert.equal(audit.after_data.total_amount, 180);
  await rejects(db.query('select amend_accounting_voucher($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [COMPANY, ADMIN, pv, '2026-11-06', 'Ah Seng', PROPERTY, BANK_GL, null, 'Paint job', JSON.stringify([{ account_id: REPAIRS, amount: '1' }]), 'Second edit of old revision']), /voucher_already_changed/);
});

test('void posts an automatic reversal with a reason; posted rows stay immutable', async () => {
  const before = await trialBalance();
  const pv = (await postVoucher('PV', [{ account_id: REPAIRS, amount: '75' }])).id;
  const reversalId = (await one('select void_accounting_voucher($1,$2,$3,$4) as id', [COMPANY, ADMIN, pv, 'Keyed twice by mistake'])).id;
  assert.ok(reversalId);
  const row = await one('select * from accounting_vouchers where id=$1', [pv]);
  assert.equal(row.status, 'voided');
  assert.equal(row.void_reason, 'Keyed twice by mistake');
  assert.deepEqual(await trialBalance(), before);
  await rejects(db.query(`update accounting_vouchers set description='changed' where id=$1`, [pv]), /voucher_immutable/);
  await rejects(db.query(`delete from accounting_voucher_lines where voucher_id=$1`, [pv]), /voucher_immutable/);
  await rejects(db.query(`update accounting_journal_entries set description='x' where id=$1`, [row.journal_entry_id]), /voucher_journal_immutable/);
  await rejects(db.query(`delete from accounting_journal_lines where journal_entry_id=$1`, [reversalId]), /voucher_journal_immutable/);
});

test('bank-matched vouchers keep the match only when the bank side is unchanged', async () => {
  const pv = (await postVoucher('PV', [{ account_id: REPAIRS, amount: '40' }])).id;
  await db.query(`insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,match_method,created_by) values($1,'accounting_voucher',$2,-40,'manual',$3)`, [id(90), pv, ADMIN]);
  await rejects(db.query('select amend_accounting_voucher($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [COMPANY, ADMIN, pv, '2026-11-05', 'Ah Seng', null, BANK_GL, null, 'x', JSON.stringify([{ account_id: REPAIRS, amount: '45' }]), 'Changed amount']), /voucher_bank_matched/);
  const ok = await one('select amend_accounting_voucher($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) as id', [COMPANY, ADMIN, pv, '2026-11-05', 'Ah Seng', null, BANK_GL, null, 'Reclass', JSON.stringify([{ account_id: OTHER_INCOME, amount: '40' }]), 'Wrong account picked']);
  assert.ok(ok.id);
  await rejects(db.query('select void_accounting_voucher($1,$2,$3,$4)', [COMPANY, ADMIN, ok.id, 'Try to void matched']), /voucher_bank_matched/);
});

test('existing manual journals become editable as JV with reversal and audit', async () => {
  const entry = await one(`select * from accounting_journal_entries where description='PAYROLL SEPT 2026'`);
  const before = await trialBalance();
  const newId = (await one('select amend_journal_entry($1,$2,$3,$4,$5,$6,$7,$8) as id', [COMPANY, ADMIN, entry.id, '2026-09-30', null, 'PAYROLL SEPT 2026 (corrected)',
    JSON.stringify([{ account_id: REPAIRS, debit: '120', credit: '0' }, { account_id: PAYABLE, debit: '0', credit: '120' }]), 'Payroll was RM120 not RM100'])).id;
  const revision = await one('select * from accounting_vouchers where id=$1', [newId]);
  assert.equal(revision.voucher_type, 'JV');
  assert.equal(revision.voucher_number, entry.entry_number, 'legacy JE number is kept');
  assert.equal(revision.origin, 'manual_journal');
  const after = await trialBalance();
  assert.equal(Number(after['5200']) - Number(before['5200']), 20);
  assert.equal(Number(after['2000']) - Number(before['2000']), -20);
  assert.ok(await one(`select 1 as ok from accounting_audit_logs where action='journal_adopted_as_voucher'`));
  const voided = await one('select void_journal_entry($1,$2,$3,$4) as id', [COMPANY, ADMIN, revision.journal_entry_id, 'Payroll moved to next month']).catch((e) => e);
  assert.ok(!(voided instanceof Error), String(voided));
});

test('bank reconciliation payment vouchers can be edited and voided with reversing rows', async () => {
  await db.exec(`insert into bank_statement_imports(id,company_id,status) values('${id(60)}','${COMPANY}','in_progress');
    insert into bank_statement_lines(id,bank_account_id,statement_import_id,transaction_date,amount,status) values('${id(61)}','${BANK}','${id(60)}','2026-11-12',-90,'unmatched');`);
  const created = (await one(`select record_bank_expense_voucher($1,$2,$3,'TNB',$4) as r`, [COMPANY, ADMIN, id(61),
    JSON.stringify([{ accountId: REPAIRS, propertyId: PROPERTY, description: 'Bill', amount: '90' }])])).r;
  assert.match(created.voucher_number, /^PV2611-\d{3}$/);
  const number = created.voucher_number;
  const pnl = async () => Number((await one(`select coalesce(sum(-amount),0)::numeric(14,2)::text as n from bank_manual_transactions where reference_number=$1 and offset_account_id=$2`, [number, REPAIRS])).n);
  assert.equal(await pnl(), 90);
  await rejects(db.query(`select amend_bank_payment_voucher($1,$2,$3,'TNB',$4,'Split bill')`, [COMPANY, ADMIN, number, JSON.stringify([{ accountId: REPAIRS, propertyId: 'office', description: 'Bill', amount: '80' }])]), /voucher_total/);
  const amended = (await one(`select amend_bank_payment_voucher($1,$2,$3,'TNB Sabah',$4,'Part of the bill is income refund') as r`, [COMPANY, ADMIN, number,
    JSON.stringify([{ accountId: REPAIRS, propertyId: PROPERTY, description: 'Bill', amount: '60' }, { accountId: OTHER_INCOME, propertyId: 'office', description: 'Refund', amount: '30' }])])).r;
  assert.equal(amended.revision, 2);
  assert.equal(await pnl(), 60, 'original + reversal + correction net to the corrected amount');
  const matched = await one(`select coalesce(sum(matched_amount),0)::numeric::text as n from bank_reconciliation_matches where statement_line_id=$1`, [id(61)]);
  assert.equal(Number(matched.n), -90, 'bank line stays exactly reconciled');
  await db.query(`select void_bank_payment_voucher($1,$2,$3,'Wrong statement line')`, [COMPANY, ADMIN, number]);
  assert.equal(await pnl(), 0);
  assert.equal((await one('select status from bank_statement_lines where id=$1', [id(61)])).status, 'unmatched');
  assert.equal((await one(`select count(*)::int as n from bank_reconciliation_matches where statement_line_id=$1`, [id(61)])).n, 0);
  await rejects(db.query(`select void_bank_payment_voucher($1,$2,$3,'Again please')`, [COMPANY, ADMIN, number]), /voucher_missing/);
  const actions = (await rows(`select action from accounting_audit_logs where entity_type='bank_payment_voucher' order by performed_at`)).map((r) => r.action);
  assert.deepEqual(actions, ['bank_voucher_amended', 'bank_voucher_voided']);
});

test('trial balance stays balanced after every correction', async () => {
  const totals = await one(`select sum(debit)::numeric(14,2)::text as d, sum(credit)::numeric(14,2)::text as c from accounting_journal_lines`);
  assert.equal(totals.d, totals.c);
});
