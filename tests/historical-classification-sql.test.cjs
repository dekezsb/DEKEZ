// Actual PostgreSQL functions; disposable data only, never live financial tests.
const {PGlite}=require('@electric-sql/pglite');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migration=n=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',n),'utf8');
let db;
const rows=async sql=>(await db.query(sql)).rows;
test.before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table companies(id uuid primary key);
 create table profiles(id uuid primary key,role text);
 create table company_users(company_id uuid,user_id uuid,profile_id uuid,status text,role text);
 create table user_module_permissions(profile_id uuid,module_key text,access_level text);
 create table bank_accounts(id uuid primary key,company_id uuid,is_active boolean);
 create table accounting_accounts(id uuid primary key,company_id uuid,system_key text,code text,account_type text,is_active boolean);
 create table accounting_periods(company_id uuid,period_start date,period_end date,status text);
 create table payments(id uuid primary key,company_id uuid,origin_bank_line_id uuid,status text,reversed_at timestamptz,category text,amount numeric,payment_date date,reference_number text);
 create table bank_account_transfers(id uuid primary key,company_id uuid,to_bank_account_id uuid,to_statement_line_id uuid,transfer_date date,amount numeric,reference_number text);
 create table tenants(id uuid primary key,name text);
 create table tenancies(id uuid primary key,start_date date);
 create table rent_bills(id uuid primary key,amount numeric,paid_amount numeric);
 create table receipts(id uuid primary key);
 create table bank_statement_imports(id uuid primary key,company_id uuid,bank_account_id uuid,status text,period_start date,period_end date,opening_balance numeric,closing_balance numeric,reconciled_at timestamptz,reconciled_by uuid,updated_at timestamptz);
 create table bank_statement_lines(id uuid primary key,statement_import_id uuid,bank_account_id uuid,amount numeric,transaction_date date,reference_number text,description text,status text,updated_at timestamptz,duplicate_of_line_id uuid,created_at timestamptz default now());
 create view bank_statement_transactions as select * from bank_statement_lines;
 create table bank_reconciliation_matches(id uuid primary key default gen_random_uuid(),statement_line_id uuid,source_type text,source_id uuid,matched_amount numeric,existing_payment_link boolean);
 create table bank_manual_transactions(id uuid primary key,company_id uuid,bank_account_id uuid,offset_account_id uuid,transaction_date date,amount numeric,description text,reference_number text);
 create table accounting_journal_entries(id uuid primary key,company_id uuid,source_type text,source_id uuid,status text);
 create table accounting_journal_lines(journal_entry_id uuid,account_id uuid,debit numeric,credit numeric);
 create table accounting_audit_logs(company_id uuid,entity_type text,entity_id uuid,action text,after_data jsonb,before_data jsonb,performed_by uuid,reason text);`);
 await db.exec(migration('20261021064148_historical_rental_credit_batch.sql'));
 await db.exec(migration('20261021074439_historical_credit_default_classification.sql'));
 await db.exec(migration('20261021075645_historical_credit_preserve_partial_categories.sql'));
 await db.exec(migration('20261021170836_september_leftover_credit_scope.sql'));
});
test.after(async()=>db?.close());
test.beforeEach(async()=>{
 await db.exec(`truncate companies,profiles,company_users,user_module_permissions,bank_accounts,accounting_accounts,accounting_periods,payments,bank_account_transfers,tenants,tenancies,rent_bills,receipts,bank_statement_imports,bank_statement_lines,bank_reconciliation_matches,bank_manual_transactions,accounting_journal_entries,accounting_journal_lines,accounting_audit_logs,historical_credit_runs,historical_bank_credit_classifications cascade;
 insert into companies values('${id(1)}'); insert into profiles values('${id(2)}','admin'),('${id(3)}','staff');
 insert into bank_accounts values('${id(4)}','${id(1)}',true);
 insert into accounting_accounts values('${id(5)}','${id(1)}','rental_receivable','1100','asset',true),('${id(6)}','${id(1)}','tenant_security_deposits','2200','liability',true),('${id(7)}','${id(1)}','renovation_income','4050','income',true);
 insert into bank_statement_imports(id,company_id,bank_account_id,status,period_start,period_end,opening_balance,closing_balance) values('${id(10)}','${id(1)}','${id(4)}','in_progress','2026-07-01','2026-07-31',0,18360);
 insert into tenants values('${id(11)}','Untouched tenant'); insert into tenancies values('${id(12)}','2025-12-15'); insert into rent_bills values('${id(13)}',500,100);`);
});
async function bank(n=20,amount=18360,status='unmatched',date='2026-07-15',description='UNKNOWN DEPOSIT',reference=null){
 await db.query('insert into bank_statement_lines(id,statement_import_id,bank_account_id,amount,status,transaction_date,description,reference_number) values($1,$2,$3,$4,$5,$6,$7,$8)',[id(n),id(10),id(4),amount,status,date,description,reference]);
}
const preview=async(actor=2)=>(await db.query('select preview_historical_credit_classification($1,$2,$3) p',[id(1),id(4),id(actor)])).rows[0].p;
const apply=async(p,run=100)=>(await db.query('select clear_historical_credit_classification($1,$2,$3,$4,$5) r',[id(1),id(4),id(2),id(run),p.hash])).rows[0].r;
async function unchanged(){
 const result={};
 for(const t of ['tenants','tenancies','rent_bills','payments','receipts','bank_manual_transactions','accounting_journal_entries','accounting_journal_lines','bank_reconciliation_matches'])result[t]=await rows(`select * from ${t}`);
 result.debits=await rows('select * from bank_statement_lines where amount<0');return result;
}
test('unidentified July money, no payment/receipt/invoice/code: full RM18360 ready and credited exactly once',async()=>{
 await bank();const p=await preview();assert.equal(p.rows[0].ready,18360);assert.equal(p.rows[0].new_ar_credit,18360);assert.equal(p.rows[0].reason,null);
 const before=await unchanged(), original=(await rows('select * from bank_statement_lines'))[0];const r=await apply(p);
 assert.equal(r.cleared_amount,18360);assert.equal(r.new_ar_credit,18360);assert.equal(r.completed_statements.length,1);
 assert.deepEqual(await unchanged(),before);
 const c=(await rows('select *,classification_date::text as effective_date from historical_bank_credit_classifications'))[0];assert.equal(Number(c.amount),18360);assert.equal(c.account_id,id(5));assert.equal(c.effective_date,p.adjustment_date);assert.equal(c.source_snapshot.description,original.description);
 const after=(await rows('select * from bank_statement_lines'))[0];for(const k of ['id','amount','transaction_date','description','reference_number','bank_account_id'])assert.deepEqual(after[k],original[k]);assert.equal(after.status,'adjusted');
 assert.deepEqual(await apply(p),r);assert.equal((await apply(await preview(),101)).cleared_count,0);assert.equal((await rows('select * from historical_bank_credit_classifications')).length,1);
});
test('completed credits and debit allocations stay byte-for-byte unchanged; unresolved debit keeps month active',async()=>{
 await bank();await bank(21,250,'matched');await bank(22,350,'adjusted');await bank(23,-100,'unmatched');
 await db.exec(`insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount) values('${id(21)}','payment','${id(40)}',250),('${id(23)}','expense','${id(41)}',-50)`);
 const done=await rows("select * from bank_statement_lines where status in ('matched','adjusted')"),before=await unchanged();const r=await apply(await preview());
 assert.equal(r.completed_statements.length,0);assert.deepEqual(await unchanged(),before);assert.deepEqual(await rows(`select * from bank_statement_lines where id in ('${id(21)}','${id(22)}')`),done);
});
test('partial allocations are retained and only the unallocated remainder is classified',async()=>{
 await bank(20,500);await db.exec(`insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount,existing_payment_link) values('${id(20)}','payment','${id(40)}',100,true)`);
 const p=await preview();assert.equal(p.rows[0].allocated,100);assert.equal(p.rows[0].ready,400);const before=await unchanged();await apply(p);assert.deepEqual(await unchanged(),before);assert.equal(Number((await rows('select amount from historical_bank_credit_classifications'))[0].amount),400);
});
test('deposit words alone are not exclusions; explicitly linked refundable deposit is protected',async()=>{
 await bank(20,100,'unmatched','2026-07-15','deposit security cagaran refundable');await bank(21,200);
 await db.exec(`insert into payments values('${id(40)}','${id(1)}','${id(21)}','confirmed',null,'deposit',200,null,null)`);
 const p=await preview();assert.equal(p.rows[0].ready,100);assert.equal(p.rows[1].reason,'known_security_liability');const before=await unchanged();await apply(p);assert.deepEqual(await unchanged(),before);assert.equal((await rows(`select status from bank_statement_lines where id='${id(21)}'`))[0].status,'unmatched');
});
test('known manual liability/non-rental offset and posted journal category stay unchanged',async()=>{
 await bank(20,100,'unmatched','2026-07-15','rent','REF0020');await bank(21,200);
 await db.exec(`insert into bank_manual_transactions values('${id(40)}','${id(1)}','${id(4)}','${id(6)}','2026-07-15',100,'Security deposit','REF0020');
 insert into accounting_journal_entries values('${id(41)}','${id(1)}','bank','${id(21)}','posted');insert into accounting_journal_lines values('${id(41)}','${id(7)}',0,200);`);
 const p=await preview();assert.deepEqual(p.rows.map(r=>r.reason),['known_other_category','known_other_category']);const before=await unchanged();assert.equal((await apply(p)).cleared_count,0);assert.deepEqual(await unchanged(),before);
});
test('existing transfer/deposit portions remain untouched; their unallocated remainder is not presumed non-rental',async()=>{
 await bank(20,500);await bank(21,300);await db.exec(`insert into payments values('${id(40)}','${id(1)}',null,'confirmed',null,'deposit',100,null,null);
 insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount) values('${id(20)}','bank_account_transfer','${id(41)}',100),('${id(21)}','payment','${id(40)}',100)`);
 const p=await preview();assert.deepEqual(p.rows.map(r=>r.ready),[400,200]);const before=await unchanged();await apply(p);assert.deepEqual(await unchanged(),before);
});
test('already posted AR is not credited twice even if reconciliation flag is stale',async()=>{
 await bank();await db.exec(`insert into accounting_journal_entries values('${id(40)}','${id(1)}','bank','${id(20)}','posted'); insert into accounting_journal_lines values('${id(40)}','${id(5)}',0,18360)`);
 const p=await preview();assert.equal(p.rows[0].reason,'already_accounted');const before=await unchanged();await apply(p);assert.deepEqual(await unchanged(),before);
});
test('exact recorded deposit reference and transfer retain their category without requiring any new match',async()=>{
 await bank(20,100,'unmatched','2026-07-15','unknown','DEP0020');await bank(21,200);
 await db.exec(`insert into payments values('${id(40)}','${id(1)}',null,'confirmed',null,'deposit',100,'2026-07-15','DEP0020');
 insert into bank_account_transfers values('${id(41)}','${id(1)}','${id(4)}','${id(21)}','2026-07-15',200,null)`);
 const p=await preview();assert.equal(p.rows[0].reason,'known_security_liability');assert.equal(p.rows[1].reason,'known_other_category');
});
test('no fuzzy-duplicate exclusion; known duplicate imports alone are skipped',async()=>{
 await bank(20,100);await bank(21,100);await bank(22,100);await db.exec(`update bank_statement_lines set duplicate_of_line_id='${id(20)}' where id='${id(22)}'`);
 const p=await preview();assert.equal(p.rows.length,2);assert.ok(p.rows.every(r=>r.ready===100));
});
test('March and August included, February/September and money out untouched',async()=>{
 await bank(20,100,'unmatched','2026-03-01');await bank(21,100,'unmatched','2026-08-31');await bank(22,100,'unmatched','2026-09-01');await bank(23,100,'unmatched','2026-02-28');await bank(24,-100);
 const p=await preview();assert.equal(p.rows.length,2);await apply(p);assert.equal((await rows("select count(*)::int n from bank_statement_lines where status='unmatched'"))[0].n,3);
});
test('prior locked periods unchanged; current locked date refuses entire batch',async()=>{
 await bank();await db.exec(`insert into accounting_periods values('${id(1)}','2026-03-01','2026-08-31','locked')`);let p=await preview();assert.equal(p.period_locked,false);
 await db.exec(`insert into accounting_periods values('${id(1)}','${p.adjustment_date}','${p.adjustment_date}','locked')`);p=await preview();assert.equal(p.period_locked,true);await assert.rejects(apply(p),/current_period_locked/);assert.equal((await rows('select * from historical_bank_credit_classifications')).length,0);
});
test('stale confirmation and unauthorised roles rejected without partial mutation',async()=>{
 await bank();const p=await preview();await db.exec('update bank_statement_lines set amount=100');await assert.rejects(apply(p),/preview_changed/);await assert.rejects(preview(3),/not_authorized/);assert.equal((await rows('select * from historical_bank_credit_classifications')).length,0);
});
test('classified source and audit offset are immutable and cannot be reconciled again',async()=>{
 await bank();await apply(await preview());await assert.rejects(db.exec('update historical_bank_credit_classifications set amount=1'),/immutable/);
 await assert.rejects(db.exec('delete from historical_bank_credit_classifications'),/immutable/);await assert.rejects(db.exec('update bank_statement_lines set amount=1'),/immutable/);
 await assert.rejects(db.exec(`insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount) values('${id(20)}','payment','${id(40)}',1)`),/already_classified/);
});
const septemberPreview=async(actor=2)=>(await db.query('select preview_september_credit_cleanup($1,$2,$3) p',[id(1),id(4),id(actor)])).rows[0].p;
test('September grouped receipts, delayed bank dates and non-equal amounts preserve already recorded accounting',async()=>{
 await bank(20,1575,'unmatched','2026-09-04','unknown','095917');
 await bank(21,480,'unmatched','2026-09-02','unknown','962673');
 await bank(22,359,'unmatched','2026-09-05','unknown','257345');
 await db.exec(`insert into payments values
 ('${id(40)}','${id(1)}',null,'confirmed',null,'monthly_rent',450,'2026-09-01','095917'),
 ('${id(41)}','${id(1)}',null,'confirmed',null,'deposit',1125,'2026-09-01','095917'),
 ('${id(42)}','${id(1)}',null,'confirmed',null,'monthly_rent',450,'2026-09-02','962673'),
 ('${id(43)}','${id(1)}',null,'confirmed',null,'electricity',30,'2026-09-02','962673'),
 ('${id(44)}','${id(1)}',null,'confirmed',null,'monthly_rent',350,'2026-09-05','257345'),
 ('${id(45)}','${id(1)}',null,'confirmed',null,'damage',19,'2026-09-05','257345')`);
 await captureSeptember();const p=await septemberPreview();
 assert.deepEqual(p.rows.map(r=>r.ready),[0,0,0]);
 assert.equal(p.rows.find(r=>r.id===id(20)).reason,'known_security_liability');
 assert.equal(p.rows.find(r=>r.id===id(22)).existing_accounted_amount,359);
 const before=await unchanged();await septemberApply(p);assert.deepEqual(await unchanged(),before);
});
test('September already allocated grouped receipt does not exclude a genuinely unallocated remainder',async()=>{
 await bank(20,1200,'unmatched','2026-09-21','unknown','130193');
 await db.exec(`insert into payments values('${id(40)}','${id(1)}',null,'confirmed',null,'monthly_rent',600,'2026-09-21','130193');
 insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount) values('${id(20)}','payment','${id(40)}',600)`);
 await captureSeptember();const p=await septemberPreview();assert.equal(p.rows[0].ready,600);
 const before=await unchanged();await septemberApply(p);assert.deepEqual(await unchanged(),before);
});
const septemberApply=async(p,run=200)=>(await db.query('select clear_september_credit_cleanup($1,$2,$3,$4,$5) r',[id(1),id(4),id(2),id(run),p.hash])).rows[0].r;
async function captureSeptember() {
 await db.exec(`insert into september_credit_cleanup_scope(statement_line_id,company_id,bank_account_id,captured_remaining,source_snapshot)
 select bl.id,'${id(1)}',bl.bank_account_id,bl.amount-coalesce((select sum(matched_amount) from bank_reconciliation_matches where statement_line_id=bl.id),0),to_jsonb(bl)
 from bank_statement_lines bl where amount>0 and transaction_date>='2026-09-01' and transaction_date<'2026-10-01'
 and status not in ('matched','adjusted','ignored') and duplicate_of_line_id is null`);
}
test('September fixed scope: future imports and previously completed sources cannot enter the batch',async()=>{
 await bank(20,100,'unmatched','2026-09-15');await bank(21,200,'matched','2026-09-15');
 await captureSeptember();
 await bank(22,300,'unmatched','2026-09-16');await bank(23,400,'unmatched','2026-10-01');await bank(24,-500,'unmatched','2026-09-15');
 await db.exec(`update bank_statement_lines set status='unmatched' where id='${id(21)}'`);
 const p=await septemberPreview();assert.deepEqual(p.rows.map(r=>r.id),[id(20)]);
 const before=await unchanged();await septemberApply(p);assert.deepEqual(await unchanged(),before);
 assert.equal((await rows("select count(*)::int n from bank_statement_lines where status='unmatched'"))[0].n,4);
 assert.equal((await preview()).rows.length,0);
});
test('September no-evidence remainder credits 1100 once, keeps dates, and completes a zero-work statement',async()=>{
 await bank(20,100,'unmatched','2026-09-15');
 await db.exec("update bank_statement_imports set period_start='2026-09-01',period_end='2026-09-30',closing_balance=100");
 await captureSeptember();const p=await septemberPreview(),before=await unchanged();
 const original=(await rows('select * from bank_statement_lines'))[0];
 const result=await septemberApply(p);assert.equal(result.cleared_amount,100);assert.equal(result.completed_statements.length,1);
 assert.deepEqual(await unchanged(),before);const c=(await rows('select *,classification_date::text effective_date from historical_bank_credit_classifications'))[0];
 assert.equal(c.account_id,id(5));assert.equal(c.effective_date,p.adjustment_date);assert.equal(c.source_snapshot.classification_policy,'management_september_frozen_leftovers');
 assert.equal(Number(c.source_snapshot.amount),Number(original.amount));
 assert.equal(c.source_snapshot.transaction_date,new Date(original.transaction_date).toISOString().slice(0,10));
 for(const key of ['reference_number','description'])assert.deepEqual(c.source_snapshot[key],original[key]);
 assert.deepEqual(await septemberApply(p),result);assert.equal((await septemberApply(await septemberPreview(),201)).cleared_count,0);
 assert.equal((await rows('select count(*)::int n from historical_bank_credit_classifications'))[0].n,1);
});
test('September known liability, valid other category and existing AR payments are not posted twice',async()=>{
 await bank(20,100,'unmatched','2026-09-15');await bank(21,430,'unmatched','2026-09-15');await bank(22,200,'unmatched','2026-09-15','renovation','REN001');
 await db.exec(`insert into payments values('${id(40)}','${id(1)}','${id(20)}','confirmed',null,'deposit',100,'2026-09-15',null),
 ('${id(41)}','${id(1)}','${id(21)}','confirmed',null,'monthly_rent',430,'2026-09-15',null);
 insert into bank_manual_transactions values('${id(42)}','${id(1)}','${id(4)}','${id(7)}','2026-09-15',200,'renovation','REN001')`);
 await captureSeptember();const p=await septemberPreview();assert.deepEqual(p.rows.map(r=>r.reason),['known_security_liability','already_accounted','known_other_category']);
 const before=await unchanged(),banks=await rows('select * from bank_statement_lines');assert.equal((await septemberApply(p)).cleared_count,0);
 assert.deepEqual(await unchanged(),before);assert.deepEqual(await rows('select * from bank_statement_lines'),banks);
});
test('September partial allocations stay intact and completed-during-preview causes stale batch rejection',async()=>{
 await bank(20,500,'unmatched','2026-09-15');await db.exec(`insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount) values('${id(20)}','payment','${id(40)}',100)`);
 await captureSeptember();const p=await septemberPreview();assert.equal(p.rows[0].ready,400);
 await db.exec(`update bank_statement_lines set status='matched' where id='${id(20)}'`);
 await assert.rejects(septemberApply(p),/preview_changed/);const before=await unchanged();
 assert.equal((await septemberApply(await septemberPreview(),201)).cleared_count,0);assert.deepEqual(await unchanged(),before);
});
test('September current lock, wrong role and changed source all fail without partial postings',async()=>{
 await bank(20,500,'unmatched','2026-09-15');await captureSeptember();let p=await septemberPreview();
 await assert.rejects(septemberPreview(3),/not_authorized/);
 await db.exec(`insert into accounting_periods values('${id(1)}','${p.adjustment_date}','${p.adjustment_date}','locked')`);
 p=await septemberPreview();await assert.rejects(septemberApply(p),/current_period_locked/);
 await db.exec("delete from accounting_periods; update bank_statement_lines set reference_number='CHANGED'");
 p=await septemberPreview();assert.equal(p.rows[0].reason,'source_changed');await assert.rejects(septemberApply(p),/source_changed/);
 assert.equal((await rows('select count(*)::int n from historical_bank_credit_classifications'))[0].n,0);
});
test('September manifest is immutable, service cannot widen it, and classification cannot bypass allowlist',async()=>{
 await bank(20,500,'unmatched','2026-09-15');await captureSeptember();
 await assert.rejects(db.exec('update september_credit_cleanup_scope set captured_remaining=9999'),/immutable/);
 await assert.rejects(db.exec('delete from september_credit_cleanup_scope'),/immutable/);
 const privileges=await rows("select has_table_privilege('service_role','september_credit_cleanup_scope','INSERT') ins, has_function_privilege('authenticated','clear_september_credit_cleanup(uuid,uuid,uuid,uuid,text)','EXECUTE') exe");
 assert.equal(privileges[0].ins,false);assert.equal(privileges[0].exe,false);
 await bank(21,100,'unmatched','2026-09-15');
 await assert.rejects(db.exec(`insert into historical_bank_credit_classifications(company_id,bank_account_id,statement_line_id,account_id,amount,classification_date,original_bank_date,original_statement_month,description,source_snapshot,run_id,created_by)
 values('${id(1)}','${id(4)}','${id(21)}','${id(5)}',100,current_date,'2026-09-15','2026-09-01','bypass','{}','${id(200)}','${id(2)}')`),/source_not_authorized/);
});
test('September removed old allocation cannot increase approved remainder; new allocation decreases it safely',async()=>{
 await bank(20,500,'unmatched','2026-09-15');
 await db.exec(`insert into bank_reconciliation_matches(statement_line_id,source_type,source_id,matched_amount) values('${id(20)}','payment','${id(40)}',100)`);
 await captureSeptember();await db.exec('update bank_reconciliation_matches set matched_amount=50');
 let p=await septemberPreview();assert.equal(p.rows[0].reason,'source_changed');await assert.rejects(septemberApply(p),/source_changed/);
 await db.exec('update bank_reconciliation_matches set matched_amount=150');p=await septemberPreview();assert.equal(p.rows[0].ready,350);
 const before=await unchanged();await septemberApply(p);assert.deepEqual(await unchanged(),before);
});
test('September unfinished Money Out prevents completion without editing the debit',async()=>{
 await bank(20,100,'unmatched','2026-09-15');await bank(21,-50,'unmatched','2026-09-15');
 await captureSeptember();await db.exec("update bank_statement_imports set closing_balance=50");
 const before=await unchanged();assert.equal((await septemberApply(await septemberPreview())).completed_statements.length,0);assert.deepEqual(await unchanged(),before);
});
