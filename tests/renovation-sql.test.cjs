const { PGlite } = require('@electric-sql/pglite');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const migration = fs.readFileSync('supabase/migrations/20261019084438_renovation_documents.sql', 'utf8');
const journal = fs.readFileSync('supabase/migrations/20260814155906_post_manual_journal_entries.sql', 'utf8');
const foundation = fs.readFileSync('supabase/migrations/20260805090954_accounting_pnl_bank_reconciliation.sql', 'utf8').split('create table if not exists public.bank_accounts')[0];
const existingGuard = fs.readFileSync('supabase/migrations/20260921092807_existing_payment_split_reconciliation.sql', 'utf8').match(/create or replace function public\.guard_existing_payment_bank_match\(\)[\s\S]*?\$\$;/)[0];
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let db;
const rows = async sql => (await db.query(sql)).rows;
test.before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table companies(id uuid primary key); create table profiles(id uuid primary key,role text);
    create table company_users(company_id uuid,user_id uuid,profile_id uuid,status text,role text);
    create table properties(id uuid primary key,company_id uuid);
    ${foundation}
    create table bank_accounts(id uuid primary key,company_id uuid,accounting_account_id uuid);
    create table bank_statement_imports(id uuid primary key,company_id uuid,status text,period_start date default '2026-10-01');
    create table bank_statement_lines(id uuid primary key,bank_account_id uuid,statement_import_id uuid,amount numeric,status text,duplicate_of_line_id uuid,updated_at timestamptz);
    create table bank_manual_transactions(id uuid primary key default gen_random_uuid(),company_id uuid,bank_account_id uuid,offset_account_id uuid,transaction_date date,amount numeric,description text,reference_number text,attachment_bucket_name text,attachment_file_path text,created_by uuid);
    create table bank_reconciliation_matches(id uuid primary key default gen_random_uuid(),statement_line_id uuid,source_type text,source_id uuid,matched_amount numeric,match_method text,created_by uuid,existing_payment_link boolean not null default false,unique(statement_line_id,source_type,source_id));
    create table accounting_audit_logs(company_id uuid,entity_type text,entity_id uuid,action text,before_data jsonb,after_data jsonb,reason text,performed_by uuid);
    create table rent_bills(id uuid primary key,paid_amount numeric); create table payments(id uuid primary key); create table receipts(id uuid primary key);
    ${journal}
    ${existingGuard}
    create trigger guard_existing_payment_bank_match before insert or update on bank_reconciliation_matches for each row execute function guard_existing_payment_bank_match();
    ${migration}
    grant usage on schema public,auth to service_role;
    grant select,insert,update on all tables in schema public to service_role;
    grant select on auth.users to service_role;`);
});
test.after(async () => db?.close());
async function fixture() {
  await db.exec(`reset role; truncate renovation_payment_submissions,renovation_documents,renovation_clients,renovation_catalogue,accounting_journal_lines,accounting_journal_entries,accounting_accounts,accounting_periods,accounting_audit_logs,company_users,profiles,companies,auth.users,bank_manual_transactions,bank_reconciliation_matches,bank_statement_lines,bank_statement_imports,bank_accounts,rent_bills,payments,receipts cascade;
    insert into companies values('${id(1)}'),('${id(2)}');
    insert into auth.users values('${id(3)}'),('${id(4)}'); insert into profiles values('${id(3)}','super_admin'),('${id(4)}','tenant');
    insert into renovation_clients(id,company_id,name) values('${id(5)}','${id(1)}','Test Client'),('${id(6)}','${id(2)}','Other Client');
    insert into accounting_accounts(id,company_id,code,name,account_type,report_group,normal_balance) values('${id(7)}','${id(1)}','4050','Renovation Service Income','income','other_income','credit');
    insert into bank_accounts values('${id(8)}','${id(1)}',null),('${id(9)}','${id(2)}',null);
    insert into bank_statement_imports(id,company_id,status) values('${id(30)}','${id(1)}','in_progress');
    insert into bank_statement_lines values('${id(31)}','${id(8)}','${id(30)}',200,'unmatched',null,null),('${id(32)}','${id(8)}','${id(30)}',500,'unmatched',null,null),('${id(33)}','${id(9)}','${id(30)}',500,'unmatched',null,null);
    insert into rent_bills values('${id(90)}',350); insert into payments values('${id(91)}'); insert into receipts values('${id(92)}');`);
}
const payload = changes => ({ kind:'quotation',client_id:id(5),project:'Test renovation',site_address:'Test site',document_date:'2026-10-19',due_date:'2026-11-18',items:[{description:'Partition',quantity:10,unit:'SQ FT',rate:100}],stages:[{label:'Deposit',percent:50},{label:'Progress',percent:30},{label:'Final',percent:20}],terms:'Test terms',discount_kind:'percent',discount_value:10,...changes });
const save = (n=10, data=payload(),version=0,company=1,actor=3) => db.query('select save_renovation_draft($1,$2,$3,$4,$5)',[id(company),id(actor),id(n),version,JSON.stringify(data)]);
const issue = (n=10,version=1,approve=false,company=1) => db.query('select issue_renovation_document($1,$2,$3,$4,$5,$6,$7,$8) as id',[id(company),id(3),id(n),version,approve?'Client Test':null,approve?'Client accepted this exact quotation by signed document':null,approve?'2026-10-19':null,approve?'2026-11-18':null]);
async function directInvoice() { await save(10,payload({kind:'invoice'})); await issue(); return id(10); }
async function payment(n=20,amount=400,invoice=id(10),bank=8) {
  await db.query(`insert into renovation_payment_submissions(id,company_id,invoice_id,bank_account_id,amount,payment_date,reference_number,proof_path,proof_sha256,submitted_by) values($1,$2,$3,$4,$5,'2026-10-20',$6,$7,$8,$9)`,[id(n),id(1),invoice,id(bank),amount,`000REF${n}`,`${id(1)}/${invoice}/${n}.pdf`,String(n).padStart(64,'0'),id(3)]);
}
const verify = (n=20,accept=true,actor=3) => db.query('select verify_renovation_payment($1,$2,$3,$4,$5) as id',[id(1),id(actor),id(n),accept,accept?null:'Wrong slip']);
const match = (transaction,line=31,company=1) => db.query('select match_renovation_payment($1,$2,$3,$4)',[id(company),id(3),transaction,id(line)]);

test('draft and issued quotation post nothing; discounted approval posts once and retains quotation', async () => {
  await fixture(); await save();
  assert.equal(Number((await rows('select total from renovation_documents'))[0].total),900);
  await issue(); assert.equal((await rows('select * from accounting_journal_entries')).length,0);
  const invoice = (await issue(10,2,true)).rows[0].id;
  assert.notEqual(invoice,id(10)); assert.equal((await issue(10,2,true)).rows[0].id,invoice);
  const docs = await rows('select kind,status,discount_amount,total from renovation_documents order by kind');
  assert.equal(docs.length,2); assert.equal(docs[0].status,'issued'); assert.equal(docs[1].status,'approved');
  const lines = await rows('select sum(debit) debit,sum(credit) credit from accounting_journal_lines');
  assert.equal(Number(lines[0].debit),900); assert.equal(Number(lines[0].credit),900);
  assert.equal((await rows('select * from accounting_journal_entries')).length,1);
  assert.equal((await rows('select * from accounting_accounts where code=\'4050\'')).length,1);
});
test('draft edit is optimistic; issued revision preserves old quote and blocks its approval', async () => {
  await fixture(); await save(); await save(10,payload({discount_kind:'amount',discount_value:150}),1);
  await assert.rejects(save(10,payload(),1),/changed_or_issued/); await issue(10,2);
  await save(11,payload({revision_of_id:id(10),discount_value:20})); await issue(11);
  await assert.rejects(issue(10,3,true),/changed_or_issued|approval_required/);
  const old=(await rows(`select * from renovation_documents where id='${id(10)}'`))[0];
  assert.equal(old.status,'superseded'); assert.equal(Number(old.total),850);
  assert.equal((await rows('select * from accounting_journal_entries')).length,0);
});
test('locked accounting period rolls back approval, invoice and journals atomically', async () => {
  await fixture(); await save(); await issue();
  await db.exec(`insert into accounting_periods(company_id,period_start,period_end,status)values('${id(1)}','2026-10-01','2026-10-31','locked');`);
  await assert.rejects(issue(10,2,true),/journal_period_locked/);
  assert.equal((await rows('select * from renovation_documents')).length,1);
  assert.equal((await rows('select status from renovation_documents'))[0].status,'issued');
  assert.equal((await rows('select * from accounting_journal_entries')).length,0);
});
test('server rejects tampered totals, invalid discounts, stages, cross-company clients and unauthorized actors', async () => {
  await fixture();
  for(const changes of [{discount_value:101},{discount_kind:'bad'},{discount_value:-1},{items:[]},{items:[{description:'bad',quantity:1,rate:-10,unit:'LOT'}]},{stages:[{label:'Bad',percent:99}]}]) await assert.rejects(save(10,payload(changes)),/renovation_invalid/);
  await assert.rejects(save(10,payload({client_id:id(6)})),/renovation_invalid/);
  await assert.rejects(save(10,payload(),0,1,4),/not_allowed/);
  await save(10,payload({total:1,discount_amount:999}));
  assert.equal(Number((await rows('select total from renovation_documents'))[0].total),900);
  await assert.rejects(issue(10,1,false,2),/renovation_missing/);
});
test('pending proof changes no money; verification uses existing bank receipt + AR, never duplicate income', async () => {
  await fixture(); await directInvoice(); await payment();
  assert.equal((await rows('select * from bank_manual_transactions')).length,0);
  const tx=(await verify()).rows[0].id; assert.equal((await verify()).rows[0].id,tx);
  assert.equal((await rows('select * from bank_manual_transactions')).length,1);
  assert.equal((await rows('select * from accounting_journal_entries')).length,1);
  const posted=await rows('select a.system_key,b.amount from bank_manual_transactions b join accounting_accounts a on a.id=b.offset_account_id');
  assert.equal(posted[0].system_key,'renovation_receivable'); assert.equal(Number(posted[0].amount),400);
  assert.equal(Number((await rows('select paid_amount from rent_bills'))[0].paid_amount),350);
  assert.equal((await rows('select * from payments')).length,1); assert.equal((await rows('select * from receipts')).length,1);
});
test('overpayments, wrong banks and duplicate slip are blocked; rejection frees retry but keeps proof', async () => {
  await fixture(); await directInvoice(); await payment(); await verify(); await payment(21,600);
  await assert.rejects(verify(21),/overpayment/);
  await assert.rejects(payment(22,100,id(10),9),/wrong_bank/);
  await assert.rejects(db.exec(`insert into renovation_payment_submissions select '${id(23)}',company_id,invoice_id,bank_account_id,amount,payment_date,reference_number,proof_path,proof_sha256,'pending',null,submitted_by,created_at,null,null,null from renovation_payment_submissions where id='${id(20)}'`),/duplicate key/);
  await verify(21,false); assert.equal((await rows(`select status from renovation_payment_submissions where id='${id(21)}'`))[0].status,'rejected');
  await assert.rejects(verify(21),/changed/);
});
test('bank matching is partial/idempotent/account-scoped and never changes invoice paid balances or journal count', async () => {
  await fixture(); await directInvoice(); await payment(); const tx=(await verify()).rows[0].id;
  await match(tx); await match(tx); await match(tx,32);
  const matches=await rows('select matched_amount from bank_reconciliation_matches');
  assert.deepEqual(matches.map(m=>Number(m.matched_amount)),[200,200]);
  assert.equal((await rows(`select status from bank_statement_lines where id='${id(32)}'`))[0].status,'unmatched');
  await assert.rejects(match(tx,33),/verified_payment_required/);
  assert.equal((await rows('select * from bank_manual_transactions')).length,1);
  assert.equal((await rows('select * from accounting_journal_entries')).length,1);
});
test('anonymous/authenticated roles cannot read clients or invoke money mutations', async () => {
  await fixture();
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from renovation_clients'),/permission denied/);
    await assert.rejects(save(),/permission denied/);
    await assert.rejects(verify(),/permission denied/);
    await db.exec('reset role');
  }
});

test('multiple verified renovation receipts share one bank line without duplication or over-allocation', async () => {
  await fixture(); await directInvoice(); await payment(20,400); await payment(21,300);
  const first=(await verify(20)).rows[0].id, second=(await verify(21)).rows[0].id;
  await match(first,32); await match(second,32); await match(second,32);
  assert.deepEqual((await rows('select matched_amount from bank_reconciliation_matches order by matched_amount')).map(r=>Number(r.matched_amount)),[100,400]);
  assert.equal((await rows(`select status from bank_statement_lines where id='${id(32)}'`))[0].status,'matched');
  await assert.rejects(db.query(`insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount) values($1,'manual_bank_transaction',$2,201)`,[id(31),second]),/exceeds_balance/);
  await match(second,31);
  assert.equal(Number((await rows('select sum(matched_amount) as total from bank_reconciliation_matches'))[0].total),700);
  assert.equal((await rows('select * from bank_manual_transactions')).length,2);
  await assert.rejects(db.exec('update bank_reconciliation_matches set matched_amount=1'),/audited unmatch/);
});

test('general-accounting corrections cannot corrupt renovation invoice or verified receipt history', async () => {
  await fixture(); await directInvoice(); await payment(); await verify();
  await assert.rejects(db.exec('update bank_manual_transactions set amount=1'),/Verified renovation receipts/);
  await assert.rejects(db.exec('delete from bank_manual_transactions'),/Verified renovation receipts/);
  await assert.rejects(db.exec("update accounting_journal_entries set status='reversed'"),/immutable/);
  await assert.rejects(db.exec('update accounting_journal_lines set debit=1'),/immutable/);
  await assert.rejects(db.exec('update renovation_payment_submissions set amount=1'),/immutable/);
  assert.equal((await rows("select * from accounting_audit_logs where action='proof_submitted'")).length,1);
});

test('unmatching is audited and restores bank work without reversing payment verification or income', async () => {
  await fixture(); await directInvoice(); await payment(); const tx=(await verify()).rows[0].id; await match(tx);
  const m=(await rows('select id from bank_reconciliation_matches'))[0].id;
  await assert.rejects(db.query('select unmatch_renovation_payment($1,$2,$3,$4)',[id(2),id(3),m,'Test correction']),/not_allowed/);
  await db.query('select unmatch_renovation_payment($1,$2,$3,$4)',[id(1),id(3),m,'Test correction']);
  assert.equal((await rows('select status from renovation_payment_submissions'))[0].status,'verified');
  assert.equal((await rows('select * from bank_manual_transactions')).length,1);
  assert.equal((await rows('select * from accounting_journal_entries')).length,1);
  assert.equal((await rows(`select status from bank_statement_lines where id='${id(31)}'`))[0].status,'unmatched');
  assert.equal((await rows("select * from accounting_audit_logs where action='bank_unmatched'")).length,1);
  await match(tx);
});

test('service role can perform the complete flow, while original non-renovation duplicate guard is retained', async () => {
  await fixture(); await db.exec('set role service_role');
  try { await directInvoice(); await payment(); const tx=(await verify()).rows[0].id; await match(tx); }
  finally { await db.exec('reset role'); }
  await assert.rejects(db.exec(`insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount) values('${id(31)}','manual_bank_transaction','${id(99)}',1)`),/Possible duplicate/);
  const definition=(await rows("select pg_get_functiondef('public.guard_existing_payment_bank_match()'::regprocedure) as definition"))[0].definition;
  const originalBody=existingGuard.split(/begin\r?\n/)[1].split('$$;')[0];
  assert.ok(definition.includes(originalBody), 'all original rental matching rules remain verbatim');
});
