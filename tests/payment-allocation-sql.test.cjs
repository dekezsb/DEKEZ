// Real PostgreSQL execution against disposable in-memory fixtures, never production.
const {PGlite}=require('@electric-sql/pglite');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260921092807_existing_payment_split_reconciliation.sql'),'utf8');
const multiInvoiceMigration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260921095701_verified_slip_multiple_invoice_links.sql'),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let db;
test.before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key,role text);
    create table properties(id uuid primary key,property_code text);
    create table rooms(id uuid primary key,room_number text);
    create table rent_bills(id uuid primary key,bill_month date,amount numeric,paid_amount numeric);
    create table payment_submissions(id uuid primary key,verification_status text);
    create table payments(id uuid primary key,company_id uuid,amount numeric,payment_date date,reference_number text,status text,reversed_at timestamptz,
      payment_submission_id uuid,tenancy_id uuid,property_id uuid,room_id uuid,rent_bill_id uuid);
    create table receipts(id uuid primary key,payment_id uuid);
    create table bank_statement_imports(id uuid primary key,company_id uuid,status text,period_start date,reconciled_at timestamptz,reconciled_by uuid,updated_at timestamptz);
    create table bank_statement_lines(id uuid primary key,statement_import_id uuid,bank_account_id uuid,amount numeric,transaction_date date,reference_number text,description text,status text,updated_at timestamptz);
    create table bank_reconciliation_matches(id uuid primary key default gen_random_uuid(),statement_line_id uuid,source_type text,source_id uuid,matched_amount numeric,match_method text,created_by uuid,
      unique(statement_line_id,source_type,source_id));
    create table accounting_payment_reconciliations(payment_record_id uuid primary key,company_id uuid,bank_transaction_id uuid unique,reconciliation_status text,reconciled_at timestamptz,reconciled_by uuid,updated_at timestamptz,
      constraint accounting_payment_reconciliations_check check((reconciliation_status='RECONCILED')=(bank_transaction_id is not null)));
    create table accounting_audit_logs(company_id uuid,entity_type text,entity_id uuid,action text,after_data jsonb,before_data jsonb,performed_by uuid,reason text);
  `);
  await db.exec(migration);
  await db.exec(multiInvoiceMigration);
  await db.exec(`create trigger guard_existing_payment_bank_match before insert or update on bank_reconciliation_matches for each row execute function guard_existing_payment_bank_match();`);
});
test.after(async()=>{await db?.close()});
async function fixture(amounts=[380,100]){
  await db.exec(`truncate profiles,properties,rooms,rent_bills,payment_submissions,payments,receipts,bank_statement_imports,bank_statement_lines,bank_reconciliation_matches,accounting_payment_reconciliations,accounting_audit_logs;
  insert into profiles values('${id(1)}','admin'),('${id(2)}','staff');
  insert into properties values('${id(10)}','MGT');insert into rooms values('${id(11)}','15');
  insert into rent_bills values('${id(12)}','2026-09-01',480,480);
  insert into payment_submissions values('${id(13)}','verified');
  insert into bank_statement_imports(id,company_id,status,period_start)values('${id(14)}','${id(15)}','in_progress','2026-09-01');`);
  for(let i=0;i<amounts.length;i++)await db.query(`insert into payments values($1,$2,$3,'2026-09-10','0036080','confirmed',null,$4,$5,$6,$7,$8)`,[id(20+i),id(15),amounts[i],id(13),id(16),id(10),id(11),id(12)]);
}
async function bank(n,amount,reference=`ref-${n}`,description='Transfer MGT 15'){
  await db.query(`insert into bank_statement_lines(id,statement_import_id,bank_account_id,amount,transaction_date,reference_number,description,status)values($1,$2,$3,$4,'2026-09-10',$5,$6,'unmatched')`,[id(n),id(14),id(17),amount,reference,description]);
}
const reconcile=(line=30,payment=20,actor=1)=>db.query(`select reconcile_existing_payment_allocation($1,$2,$3,$4)`,[id(15),id(line),id(payment),id(actor)]);
const rows=async(sql)=>(await db.query(sql)).rows;
test('RM480 bank links existing RM380 + RM100 on a paid monthly invoice; tenant records unchanged',async()=>{
  await fixture();await bank(30,480);
  const before=await rows('select to_jsonb(p) as p from payments p order by id');
  await reconcile();
  const matches=await rows('select matched_amount,source_id from bank_reconciliation_matches order by source_id');
  assert.deepEqual(matches.map(x=>Number(x.matched_amount)),[380,100]);
  assert.equal((await rows('select status from bank_statement_lines'))[0].status,'matched');
  assert.ok((await rows('select reconciliation_status from accounting_payment_reconciliations')).every(x=>x.reconciliation_status==='RECONCILED'));
  assert.deepEqual(await rows('select to_jsonb(p) as p from payments p order by id'),before);
  assert.equal(Number((await rows('select paid_amount from rent_bills'))[0].paid_amount),480);
  assert.equal((await rows('select * from receipts')).length,0);
  await assert.rejects(reconcile(),/duplicate/);
});
test('RM100 then RM300 consumes existing RM400 once; partial remains available with paid invoice',async()=>{
  await fixture([400]);await bank(30,100);await bank(31,300,'other','Other transfer MGT 15');
  await reconcile(30);
  assert.equal((await rows('select reconciliation_status from accounting_payment_reconciliations'))[0].reconciliation_status,'PENDING');
  await reconcile(31);
  const state=(await rows('select * from accounting_payment_reconciliations'))[0];assert.equal(state.reconciliation_status,'RECONCILED');assert.equal(state.bank_transaction_id,null);
  assert.equal(Number((await rows('select sum(matched_amount) as total from bank_reconciliation_matches'))[0].total),400);
  await bank(32,1,'third','Third MGT 15');await assert.rejects(reconcile(32),/remaining/);
  assert.equal((await rows(`select status from bank_statement_lines where id='${id(32)}'`))[0].status,'unmatched');
});
test('partial combined slip followed by remaining amount works even first portion is already full',async()=>{
  await fixture();await bank(30,400);await bank(31,80,'other','Second MGT 15');await reconcile(30);await reconcile(31);
  assert.equal(Number((await rows('select sum(matched_amount) as total from bank_reconciliation_matches'))[0].total),480);
  assert.ok((await rows('select reconciliation_status from accounting_payment_reconciliations')).every(x=>x.reconciliation_status==='RECONCILED'));
});
test('duplicate bank reference/date/amount, wrong room/month/actor and mixed tenancy are rejected',async()=>{
  await fixture([400]);await bank(30,100,'same','Same MGT 15');await bank(31,100,'same','Same MGT 15');await reconcile(30);
  await assert.rejects(reconcile(31),/duplicate/);
  await bank(32,200,'new','MGT 16');await assert.rejects(reconcile(32),/room/);
  await bank(33,200,'newer','MGT 15');await assert.rejects(reconcile(33,20,2),/authorized/);
  await db.exec(`update bank_statement_lines set transaction_date='2026-08-10' where id='${id(33)}'`);await assert.rejects(reconcile(33),/month/);
  await fixture();await bank(30,480);await db.exec(`update payments set tenancy_id='${id(99)}' where id='${id(21)}'`);await assert.rejects(reconcile(),/Inconsistent/);
  assert.equal((await rows('select * from bank_reconciliation_matches')).length,0);
});
test('second portion failure rolls back first link, states, bank status and audit',async()=>{
  await fixture();await bank(30,480);
  await db.exec(`create function fail_test_portion() returns trigger language plpgsql as $$ begin if new.source_id='${id(21)}' then raise exception 'test failure';end if;return new;end;$$;
    create trigger z_fail_test before insert on bank_reconciliation_matches for each row execute function fail_test_portion();`);
  await assert.rejects(reconcile(),/test failure/);
  for(const table of ['bank_reconciliation_matches','accounting_payment_reconciliations','accounting_audit_logs'])assert.equal((await rows(`select * from ${table}`)).length,0);
  assert.equal((await rows('select status from bank_statement_lines'))[0].status,'unmatched');
  await db.exec('drop trigger z_fail_test on bank_reconciliation_matches;drop function fail_test_portion();');
});
test('deferred guard refuses to mark an incompletely allocated bank as matched',async()=>{
  await fixture();await bank(30,480);
  await assert.rejects(db.exec(`begin;insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,match_method,created_by,existing_payment_link)values('${id(30)}','payment','${id(20)}',380,'merge','${id(1)}',true);update bank_statement_lines set status='matched' where id='${id(30)}';commit;`),/remaining allocation balance/);
  await db.exec('rollback');
  assert.equal((await rows('select * from bank_reconciliation_matches')).length,0);
});
test('audited unmatch removes all portions of that bank only, retains other bank and reopens remaining',async()=>{
  await fixture([400]);await bank(30,100);await bank(31,300,'other','Other MGT 15');await reconcile(30);await reconcile(31);
  await assert.rejects(db.query('select unreconcile_existing_payment_bank($1,$2,$3,$4)',[id(15),id(31),id(2),'wrong']),/Authorized/);
  await db.query('select unreconcile_existing_payment_bank($1,$2,$3,$4)',[id(15),id(31),id(1),'Wrong bank selected']);
  assert.equal(Number((await rows('select sum(matched_amount) as total from bank_reconciliation_matches'))[0].total),100);
  assert.equal((await rows('select reconciliation_status from accounting_payment_reconciliations'))[0].reconciliation_status,'PENDING');
  await reconcile(31);
  assert.equal((await rows('select reconciliation_status from accounting_payment_reconciliations'))[0].reconciliation_status,'RECONCILED');
});
test('two concurrent requests allocate at most the remaining master, leaving bank remainder visible',async()=>{
  await fixture([400]);await bank(30,300);await bank(31,300,'other','Other MGT 15');
  const result=await Promise.allSettled([reconcile(30),reconcile(31)]);assert.equal(result.filter(x=>x.status==='fulfilled').length,2);
  assert.equal(Number((await rows('select sum(matched_amount) as total from bank_reconciliation_matches'))[0].total),400);
  assert.equal((await rows("select status from bank_statement_lines where status='unmatched'")).length,1);
});
test('RM500 bank to RM380 payment leaves RM120 bank for another verified payment',async()=>{
  await fixture([380]);await bank(30,500);await reconcile(30);
  assert.equal((await rows('select status from bank_statement_lines'))[0].status,'unmatched');
  assert.equal(Number((await rows('select sum(matched_amount) as total from bank_reconciliation_matches'))[0].total),380);
  await db.exec(`insert into payment_submissions values('${id(50)}','verified');insert into payments select '${id(21)}',company_id,120,payment_date,'OTHER',status,null,'${id(50)}',tenancy_id,property_id,room_id,rent_bill_id from payments where id='${id(20)}';`);
  await reconcile(30,21);
  assert.equal((await rows('select status from bank_statement_lines'))[0].status,'matched');
  assert.equal(Number((await rows('select sum(matched_amount) as total from bank_reconciliation_matches'))[0].total),500);
  await assert.rejects(reconcile(30,21),/duplicate/);
});
test('RM480 verified against RM300 bank leaves RM180 verified for the next bank',async()=>{
  await fixture([480]);await bank(30,300);await reconcile(30);
  assert.equal(Number((await rows('select p.amount-sum(m.matched_amount) as remaining from payments p join bank_reconciliation_matches m on m.source_id=p.id group by p.amount'))[0].remaining),180);
  await bank(31,180,'second','Second MGT 15');await reconcile(31);
  assert.equal((await rows('select reconciliation_status from accounting_payment_reconciliations'))[0].reconciliation_status,'RECONCILED');
});
test('new functions are private invoker RPCs; no financial master mutations in migration',async()=>{
  assert.doesNotMatch(migration+multiInvoiceMigration,/(?:insert into|update|delete from)\s+(?:public\.)?(?:payments|receipts|rent_bills|accounting_journal_entries|accounting_journal_lines)\b/i);
  const permissions=await rows(`select has_function_privilege('anon','reconcile_existing_payment_allocation(uuid,uuid,uuid,uuid)','EXECUTE') as anon,has_function_privilege('authenticated','reconcile_existing_payment_allocation(uuid,uuid,uuid,uuid)','EXECUTE') as authenticated,has_function_privilege('service_role','reconcile_existing_payment_allocation(uuid,uuid,uuid,uuid)','EXECUTE') as service`);
  assert.deepEqual(permissions[0],{anon:false,authenticated:false,service:true});
});

test('same verified slip covers two paid invoices without changing either invoice or payment',async()=>{
  await fixture();await bank(30,300);await bank(31,180,'next','Next MGT 15');
  await db.exec(`insert into rent_bills values('${id(60)}','2026-09-01',100,100);update rent_bills set amount=380,paid_amount=380 where id='${id(12)}';update payments set rent_bill_id='${id(60)}' where id='${id(21)}';`);
  const invoices=await rows('select * from rent_bills order by id');
  const payments=await rows('select * from payments order by id');
  await reconcile(30);
  assert.equal(Number((await rows('select sum(matched_amount) as total from bank_reconciliation_matches'))[0].total),300);
  await reconcile(31);
  assert.deepEqual((await rows('select source_id,sum(matched_amount) as total from bank_reconciliation_matches group by source_id order by source_id')).map(x=>Number(x.total)),[380,100]);
  assert.deepEqual(await rows('select * from payments order by id'),payments);
  assert.deepEqual(await rows('select * from rent_bills order by id'),invoices);
  assert.equal((await rows('select * from receipts')).length,0);
  assert.ok((await rows('select status from bank_statement_lines')).every(x=>x.status==='matched'));
});

test('single RM480 bank combines verified allocations to two already-paid invoices',async()=>{
  await fixture();await bank(30,480);
  await db.exec(`insert into rent_bills values('${id(60)}','2026-09-01',100,100);update payments set rent_bill_id='${id(60)}' where id='${id(21)}';`);
  await reconcile();
  assert.deepEqual((await rows('select matched_amount from bank_reconciliation_matches order by source_id')).map(x=>Number(x.matched_amount)),[380,100]);
});

test('different-invoice child keeps month and historical duplicate protections before any partial write',async()=>{
  await fixture();await bank(30,100);
  await db.exec(`insert into rent_bills values('${id(60)}','2026-08-01',100,100);update payments set rent_bill_id='${id(60)}' where id='${id(21)}';`);
  await assert.rejects(reconcile(),/same bank month/);
  assert.equal((await rows('select * from bank_reconciliation_matches')).length,0);
  await db.exec(`update rent_bills set bill_month='2026-09-01' where id='${id(60)}';`);
  await bank(31,100,'legacy','Legacy MGT 15');
  await db.exec(`insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,match_method)values('${id(31)}','rent_bill','${id(60)}',100,'manual');`);
  await assert.rejects(reconcile(),/duplicate/);
  assert.equal((await rows(`select * from bank_reconciliation_matches where statement_line_id='${id(30)}'`)).length,0);
});
