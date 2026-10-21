// Disposable PostgreSQL fixtures only. Never connect to or submit live accounts.
const { PGlite } = require('@electric-sql/pglite');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const read = name => fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
const migration = read('20261021064148_historical_rental_credit_batch.sql');
let db;
const rows = async sql => (await db.query(sql)).rows;
test.before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table companies(id uuid primary key);
    create table profiles(id uuid primary key,role text);
    create table company_users(company_id uuid,user_id uuid,profile_id uuid,status text,role text);
    create table user_module_permissions(profile_id uuid,module_key text,access_level text);
    create table bank_accounts(id uuid primary key,company_id uuid,is_active boolean);
    create table accounting_accounts(id uuid primary key,company_id uuid,system_key text,code text,account_type text,is_active boolean);
    create table accounting_periods(company_id uuid,period_start date,period_end date,status text);
    create table properties(id uuid primary key,property_code text);
    create table rooms(id uuid primary key,room_number text);
    create table tenants(id uuid primary key,full_name text);
    create table tenancies(id uuid primary key,tenant_id uuid,start_date date);
    create table rent_bills(id uuid primary key,bill_month date,amount numeric,paid_amount numeric,removed_at timestamptz);
    create table payment_submissions(id uuid primary key,verification_status text);
    create table payments(id uuid primary key,company_id uuid,amount numeric,payment_date date,reference_number text,status text,reversed_at timestamptz,
      payment_submission_id uuid,tenancy_id uuid,property_id uuid,room_id uuid,rent_bill_id uuid,category text,origin_bank_line_id uuid);
    create table receipts(id uuid primary key,payment_id uuid);
    create table bank_statement_imports(id uuid primary key,company_id uuid,bank_account_id uuid,status text,period_start date,period_end date,
      opening_balance numeric,closing_balance numeric,reconciled_at timestamptz,reconciled_by uuid,updated_at timestamptz);
    create table bank_statement_lines(id uuid primary key,statement_import_id uuid,bank_account_id uuid,amount numeric,transaction_date date,
      reference_number text,description text,status text,updated_at timestamptz,duplicate_of_line_id uuid);
    create view bank_statement_transactions as select * from bank_statement_lines;
    create table bank_reconciliation_matches(id uuid primary key default gen_random_uuid(),statement_line_id uuid,source_type text,source_id uuid,
      matched_amount numeric,match_method text,created_by uuid,unique(statement_line_id,source_type,source_id));
    create table accounting_payment_reconciliations(payment_record_id uuid primary key,company_id uuid,bank_transaction_id uuid unique,
      reconciliation_status text,reconciled_at timestamptz,reconciled_by uuid,updated_at timestamptz,
      constraint accounting_payment_reconciliations_check check((reconciliation_status='RECONCILED')=(bank_transaction_id is not null)));
    create table accounting_audit_logs(company_id uuid,entity_type text,entity_id uuid,action text,after_data jsonb,before_data jsonb,performed_by uuid,reason text);
    create table bank_manual_transactions(id uuid primary key,company_id uuid,bank_account_id uuid,offset_account_id uuid,transaction_date date,
      amount numeric,description text,reference_number text,property_id uuid);
    create table accounting_journal_entries(id uuid primary key,company_id uuid,entry_date date,entry_number text,source_type text,source_id uuid,
      reference_number text,description text,status text,posted_at timestamptz,created_by uuid);
    create table accounting_journal_lines(journal_entry_id uuid,account_id uuid,property_id uuid,description text,debit numeric,credit numeric,
      check ((debit>0 and credit=0) or (credit>0 and debit=0)));
  `);
  await db.exec(read('20260921092807_existing_payment_split_reconciliation.sql'));
  await db.exec(read('20260921095701_verified_slip_multiple_invoice_links.sql'));
  await db.exec('create trigger guard_existing_payment_bank_match before insert or update on bank_reconciliation_matches for each row execute function guard_existing_payment_bank_match()');
  await db.exec(migration);
});
test.after(async () => db?.close());
async function fixture() {
  await db.exec(`truncate companies,profiles,company_users,user_module_permissions,bank_accounts,accounting_accounts,accounting_periods,
    properties,rooms,tenants,tenancies,rent_bills,payment_submissions,payments,receipts,bank_statement_imports,bank_statement_lines,
    bank_reconciliation_matches,accounting_payment_reconciliations,accounting_audit_logs,bank_manual_transactions,
    accounting_journal_entries,accounting_journal_lines,historical_credit_runs cascade;
    insert into companies values('${id(15)}');
    insert into profiles values('${id(1)}','admin'),('${id(2)}','staff'),('${id(3)}','owner');
    insert into company_users values('${id(15)}','${id(3)}',null,'active','owner');
    insert into bank_accounts values('${id(17)}','${id(15)}',true);
    insert into accounting_accounts values('${id(100)}','${id(15)}','rental_receivable','1100','asset',true),
      ('${id(101)}','${id(15)}','other_receivable','1190','asset',true),('${id(102)}','${id(15)}','tenant_security_deposits','2200','liability',true);
    insert into properties values('${id(10)}','MGT'); insert into rooms values('${id(11)}','15');
    insert into tenants values('${id(18)}','Example Tenant'); insert into tenancies values('${id(16)}','${id(18)}','2025-12-15');
    insert into rent_bills values('${id(12)}','2026-08-01',400,400,null);
    insert into payment_submissions values('${id(13)}','verified');
    insert into bank_statement_imports(id,company_id,bank_account_id,status,period_start,period_end,opening_balance,closing_balance)
      values('${id(14)}','${id(15)}','${id(17)}','in_progress','2026-08-01','2026-08-31',0,400);`);
}
async function bank(n=30,amount=400,reference='REF0030',description='Example Tenant rent',date='2026-08-10',status='unmatched') {
  await db.query(`insert into bank_statement_lines(id,statement_import_id,bank_account_id,amount,transaction_date,reference_number,description,status)
    values($1,$2,$3,$4,$5,$6,$7,$8)`,[id(n),id(14),id(17),amount,date,reference,description,status]);
}
async function payment(amount=400) {
  await db.query(`insert into payments values($1,$2,$3,'2026-08-10','REF0030','confirmed',null,$4,$5,$6,$7,$8,'monthly_rent',null)`,
    [id(20),id(15),amount,id(13),id(16),id(10),id(11),id(12)]);
}
async function offset(account=101) {
  await db.query(`insert into bank_manual_transactions values($1,$2,$3,$4,'2026-08-10',400,'Tenant invoice settlement','REF0030',$5)`,[id(40),id(15),id(17),id(account),id(10)]);
}
const preview = async (actor=1) => (await db.query('select preview_historical_rental_credits($1,$2,$3) p',[id(15),id(17),id(actor)])).rows[0].p;
const apply = async (p,run=200,actor=1) => (await db.query('select clear_historical_rental_credits($1,$2,$3,$4,$5) r',[id(15),id(17),id(actor),id(run),p.hash])).rows[0].r;
async function protectedSnapshot() {
  const out={};
  for (const table of ['tenants','tenancies','rent_bills','payments','receipts','bank_manual_transactions']) out[table]=await rows(`select * from ${table} order by id`);
  out.debits=await rows('select * from bank_statement_lines where amount<0 order by id');
  out.debitMatches=await rows('select m.* from bank_reconciliation_matches m join bank_statement_lines b on b.id=m.statement_line_id where b.amount<0 order by m.id');
  return out;
}

test('existing paid invoice settles once: links only, both-side completion, retry is idempotent',async()=>{
  await fixture(); await bank(); await payment(); await bank(31,-50,'DEBIT31','Expense','2026-08-11','matched');
  await db.exec(`insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,match_method) values('${id(31)}','expense','${id(99)}',-50,'manual');
    update bank_statement_imports set closing_balance=350;`);
  const before=await protectedSnapshot(), p=await preview(); assert.equal(p.rows[0].mode,'existing_payment');
  const result=await apply(p); assert.equal(result.new_ar_credit,0); assert.equal(result.cleared_amount,400); assert.equal(result.completed_statements.length,1);
  assert.deepEqual(await protectedSnapshot(),before);
  assert.equal((await rows('select * from accounting_journal_entries')).length,0);
  assert.deepEqual(await apply(p),result); assert.equal((await rows('select * from historical_credit_runs')).length,1);
  const again=await apply(await preview(),201); assert.equal(again.cleared_count,0);
});
test('proven 1190 offset reclassifies DR1190 CR1100 at current date; original bank and locked history unchanged',async()=>{
  await fixture();await bank();await offset();
  await db.exec(`insert into accounting_periods values('${id(15)}','2026-03-01','2026-08-31','locked')`);
  const before=await protectedSnapshot(),p=await preview();assert.equal(p.rows[0].mode,'reclassify_other_ar');
  const result=await apply(p);assert.equal(result.new_ar_credit,400);
  const journal=(await rows('select *,entry_date::text as posting_date from accounting_journal_entries'))[0];assert.equal(journal.posting_date,p.adjustment_date);assert.equal(journal.source_id,id(40));
  const lines=await rows('select * from accounting_journal_lines order by account_id');
  assert.deepEqual(lines.map(x=>[x.account_id,Number(x.debit),Number(x.credit)]),[[id(100),0,400],[id(101),400,0]]);
  assert.equal(lines.reduce((n,x)=>n+Number(x.debit)-Number(x.credit),0),0);
  assert.deepEqual(await protectedSnapshot(),before);
  const audit=(await rows("select after_data from accounting_audit_logs where entity_type='historical_rental_credit'"))[0].after_data;
  assert.equal(audit.date,'2026-08-10');assert.equal(audit.reference,'REF0030');assert.equal(audit.old_account_id,id(101));
  await apply(p);assert.equal((await rows('select * from accounting_journal_entries')).length,1);
  await assert.rejects(db.exec("update accounting_journal_entries set status='reversed'"),/immutable_adjustment/);
  await assert.rejects(db.exec('delete from accounting_journal_lines'),/immutable_adjustment/);
  await assert.rejects(db.exec('update bank_manual_transactions set amount=401'),/immutable_source/);
});
test('existing 1100 offset links only without any additional receivable credit',async()=>{
  await fixture();await bank();await offset(100);const p=await preview();assert.equal(p.rows[0].mode,'existing_ar_offset');
  const r=await apply(p);assert.equal(r.new_ar_credit,0);assert.equal((await rows('select * from accounting_journal_entries')).length,0);
});
test('no source, transfers, true/mixed deposits and non-rental offsets never post',async()=>{
  await fixture();await bank();assert.equal((await preview()).rows[0].reason,'accounting_source_not_established');
  await bank(31,100,'A31','CLOSE CA MONEY TRANSFER');await bank(32,300,'A32','Rental + Deposit');
  const p=await preview();assert.deepEqual(p.rows.map(x=>x.reason),['accounting_source_not_established','transfer_or_non_rental','security_or_mixed_deposit']);
  assert.equal((await apply(p)).cleared_count,0);
  await offset(102);assert.equal((await preview()).rows[0].reason,'non_rental_offset');
  await db.exec(`delete from accounting_accounts where id='${id(101)}'`);
  assert.equal((await preview()).rows[0].reason,'non_rental_offset'); // SQL NULL must not admit liability.
});
test('deposit category protects a slip even when bank description says rent',async()=>{
  await fixture();await bank();await payment();await db.exec("update payments set category='deposit'");
  assert.equal((await preview()).rows[0].reason,'security_or_mixed_deposit');
  await db.exec('update payments set category=null');assert.equal((await preview()).rows[0].reason,'receivable_settlement_not_established');
});
test('full-name evidence works without bank code and no user matching; paid_amount must establish settlement',async()=>{
  await fixture();await bank(30,400,null);await payment();await db.exec('update payments set reference_number=null');
  assert.equal((await preview()).rows[0].mode,'existing_payment');
  await db.exec('update rent_bills set paid_amount=0');assert.equal((await preview()).rows[0].reason,'receivable_settlement_not_established');
});
test('cutoff is bank date; September, February, Money Out, void and duplicate imports excluded',async()=>{
  await fixture();await bank();await payment();await bank(31,400,'SEP31','Example Tenant','2026-09-01');
  await bank(32,400,'FEB32','Example Tenant','2026-02-28');await bank(33,-400);await bank(34,400);
  await db.exec(`update bank_statement_lines set duplicate_of_line_id='${id(30)}' where id='${id(34)}'`);
  const p=await preview();assert.deepEqual(p.rows.map(x=>x.id),[id(30)]);await apply(p);
  assert.equal((await rows(`select status from bank_statement_lines where id='${id(31)}'`))[0].status,'unmatched');
  await db.exec("update bank_statement_imports set status='void'");assert.equal((await preview()).rows.length,0);
});
test('unresolved debit prevents month completion and is never changed',async()=>{
  await fixture();await bank();await payment();await bank(31,-50);await db.exec('update bank_statement_imports set closing_balance=350');
  const before=await protectedSnapshot();const r=await apply(await preview());assert.equal(r.completed_statements.length,0);
  assert.deepEqual(await protectedSnapshot(),before);assert.equal((await rows('select status from bank_statement_imports'))[0].status,'in_progress');
});
test('partial existing payment leaves bank remainder open; never credits unknown remainder to AR',async()=>{
  await fixture();await bank();await payment(250);const p=await preview();assert.equal(p.rows[0].ready,250);
  const r=await apply(p);assert.equal(r.cleared_amount,250);assert.equal(r.new_ar_credit,0);assert.equal(r.completed_statements.length,0);
  assert.equal((await preview()).rows[0].reason,'settlement_already_fully_linked');
});
test('current locked period blocks adjustment; missing and changed previews abort without writes',async()=>{
  await fixture();await bank();await offset();const p=await preview();
  await db.exec(`insert into accounting_periods values('${id(15)}',(now() at time zone 'Asia/Kuala_Lumpur')::date,(now() at time zone 'Asia/Kuala_Lumpur')::date,'locked')`);
  assert.equal((await preview()).rows[0].reason,'current_adjustment_period_locked');
  await assert.rejects(apply(p),/preview_changed/);await assert.rejects(apply({...p,hash:''}),/confirmation_required/);
  assert.equal((await rows('select * from historical_credit_runs')).length,0);assert.equal((await rows('select * from accounting_journal_entries')).length,0);
});
test('source claimed by two banks excluded; exact duplicate bank rows excluded too',async()=>{
  await fixture();await bank(30,200,'REF0030');await bank(31,200,'REF0030','Another transfer','2026-08-11');await payment();
  assert.ok((await preview()).rows.every(x=>x.reason==='source_claimed_by_multiple_banks'));
  await db.exec("update bank_statement_lines set transaction_date='2026-08-10'");
  assert.ok((await preview()).rows.every(x=>x.reason==='possible_duplicate_bank'));
});
test('stale hash, wrong actor and wrong bank rejected; RPC/table unavailable to public roles',async()=>{
  await fixture();await bank();await payment();const p=await preview();await assert.rejects(preview(2),/not_authorized/);
  await assert.rejects(apply(p,200,2),/not_authorized/);assert.equal((await preview(3)).rows[0].mode,'existing_payment');
  await db.exec("update bank_statement_lines set description='Changed Example Tenant rent'");await assert.rejects(apply(p),/preview_changed/);
  await assert.rejects(db.query('select preview_historical_rental_credits($1,$2,$3)',[id(15),id(999),id(1)]),/not_authorized/);
  const privileges=(await rows(`select has_function_privilege('anon','clear_historical_rental_credits(uuid,uuid,uuid,uuid,text)','EXECUTE') a,
    has_function_privilege('authenticated','preview_historical_rental_credits(uuid,uuid,uuid)','EXECUTE') b,
    has_function_privilege('service_role','clear_historical_rental_credits(uuid,uuid,uuid,uuid,text)','EXECUTE') c,
    has_table_privilege('authenticated','historical_credit_runs','SELECT') d`))[0];
  assert.deepEqual(privileges,{a:false,b:false,c:true,d:false});
});
test('failure after journal creation rolls back journal, matches, status and audit together',async()=>{
  await fixture();await bank();await offset();const p=await preview();
  await db.exec(`create function fail_historical_test() returns trigger language plpgsql as $$begin raise exception 'test failure';end;$$;
    create trigger z_fail before insert on bank_reconciliation_matches for each row execute function fail_historical_test()`);
  await assert.rejects(apply(p),/test failure/);
  for(const table of ['historical_credit_runs','bank_reconciliation_matches','accounting_journal_entries','accounting_journal_lines','accounting_audit_logs']) assert.equal((await rows('select * from '+table)).length,0);
  assert.equal((await rows('select status from bank_statement_lines'))[0].status,'unmatched');
  await db.exec('drop trigger z_fail on bank_reconciliation_matches;drop function fail_historical_test()');
});
test('no financial master mutations or bank/income posting code in batch',()=>{
  assert.doesNotMatch(migration,/(?:insert into|update|delete from)\s+(?:public\.)?(?:payments|receipts|rent_bills|tenants|tenancies|bank_manual_transactions)\b/i);
  assert.match(migration,/in share mode/);assert.match(migration,/pg_advisory_xact_lock/);assert.match(migration,/enable row level security/);
});
