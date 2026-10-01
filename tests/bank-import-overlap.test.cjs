const {PGlite}=require('@electric-sql/pglite');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261001032932_reuse_overlapping_bank_transactions.sql'),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const schema=`
create role anon;create role authenticated;create role service_role bypassrls;
create function is_platform_admin() returns boolean language sql as 'select false';
create function can_manage_company(uuid) returns boolean language sql as 'select $1::text=current_setting(''test.company'',true)';
create table bank_statement_imports(id uuid primary key,bank_account_id uuid,company_id uuid,status text default 'in_progress',created_at timestamptz default now(),created_by uuid);
create table bank_statement_lines(id uuid primary key default gen_random_uuid(),statement_import_id uuid references bank_statement_imports,bank_account_id uuid,
 transaction_date date,value_date date,amount numeric not null check(amount<>0),reference_number text,description text,external_hash text not null,
 status text default 'unmatched',ignored_reason text,created_at timestamptz default now(),updated_at timestamptz,unique(statement_import_id,external_hash));
create table bank_reconciliation_matches(id uuid primary key default gen_random_uuid(),statement_line_id uuid references bank_statement_lines,matched_amount numeric);
create table accounting_payment_reconciliations(bank_transaction_id uuid);
create table payments(id uuid,origin_bank_line_id uuid,amount numeric);
create table rental_invoice_line_items(origin_bank_line_id uuid);
create table bank_account_transfers(from_statement_line_id uuid,to_statement_line_id uuid);
create table receipts(id uuid);
create table accounting_audit_logs(company_id uuid,entity_type text,entity_id uuid,action text,before_data jsonb,after_data jsonb,reason text,performed_by uuid);
alter table bank_statement_lines enable row level security;
create policy existing_line_access on bank_statement_lines for select to authenticated using(exists(select 1 from bank_statement_imports s where s.id=statement_import_id and can_manage_company(s.company_id)));
grant select on bank_statement_imports,bank_statement_lines to authenticated;
`;
async function statement(db,n,account=1,company=2){await db.query(`insert into bank_statement_imports(id,bank_account_id,company_id,created_at,created_by) values($1,$2,$3,$4,$5)`,[id(n),id(account),id(company),`2026-09-${String(n%20+1).padStart(2,'0')}T00:00:00Z`,id(3)]);}
async function line(db,n,statementId,overrides={}){
 const x={amount:480,date:'2026-09-10',reference:'000123',description:'QR REF 000123 MGT 15',hash:`hash-${n}`,account:1,status:'unmatched',...overrides};
 return db.query(`insert into bank_statement_lines(id,statement_import_id,bank_account_id,transaction_date,amount,reference_number,description,external_hash,status)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[id(n),id(statementId),id(x.account),x.date,x.amount,x.reference,x.description,x.hash,x.status]);
}
async function fixture(seed){const db=new PGlite();await db.exec(schema);await statement(db,10);await statement(db,11);if(seed)await seed(db);await db.exec('begin;'+migration+'commit;');return db;}
const rows=async(db,sql)=>(await db.query(sql)).rows;
const total=async(db,table)=>Number((await rows(db,`select count(*) n from ${table}`))[0].n);

test('repair preserves completed links, suppresses only exact duplicate rows, retains full statement totals and audit',async()=>{
 const db=await fixture(async db=>{await line(db,100,10,{status:'matched'});await line(db,101,11);await db.query('insert into bank_reconciliation_matches(statement_line_id,matched_amount)values($1,480)',[id(100)]);});
 try{
  const duplicate=(await rows(db,`select * from bank_statement_lines where id='${id(101)}'`))[0];
  assert.equal(duplicate.duplicate_of_line_id,id(100));assert.equal(duplicate.status,'ignored');
  assert.equal(await total(db,'bank_reconciliation_matches'),1);assert.equal(await total(db,'payments'),0);assert.equal(await total(db,'receipts'),0);
  const evidence=await rows(db,'select * from bank_statement_transactions order by statement_import_id');
  assert.equal(evidence.length,2);assert.equal(evidence[1].id,id(100));assert.equal(evidence[1].import_result,'ALREADY RECONCILED');
  assert.equal(Number(evidence[1].amount),480);assert.equal(await total(db,'accounting_audit_logs'),1);
  await assert.rejects(db.query(`update bank_statement_lines set status='unmatched' where id=$1`,[id(101)]),/cannot be reopened/);
  await assert.rejects(db.query('insert into bank_reconciliation_matches(statement_line_id,matched_amount)values($1,480)',[id(101)]),/ALREADY IMPORTED/);
 }finally{await db.close();}
});

test('overlap reuses pending and partial originals; only new lines create bank records',async()=>{
 const db=await fixture();try{
  await line(db,100,10);await db.query('insert into bank_reconciliation_matches(statement_line_id,matched_amount)values($1,300)',[id(100)]);
  await line(db,101,11,{hash:'different-file-row-position'});await line(db,102,11,{amount:180,reference:'NEW'});
  assert.equal(await total(db,'bank_statement_lines'),2);assert.equal(await total(db,'bank_reconciliation_matches'),1);
  const copied=(await rows(db,`select * from bank_statement_transactions where statement_import_id='${id(11)}' and is_reused`))[0];
  assert.equal(copied.id,id(100));assert.equal(copied.status,'unmatched');assert.equal(copied.import_result,'ALREADY IMPORTED');
  assert.equal(Number((await rows(db,`select l.amount-sum(m.matched_amount) remaining from bank_statement_lines l join bank_reconciliation_matches m on m.statement_line_id=l.id group by l.id`))[0].remaining),180);
  assert.equal((await rows(db,`select * from bank_statement_transactions where statement_import_id='${id(11)}' and not is_reused and status='unmatched'`)).length,1);
 }finally{await db.close();}
});

test('completed bank credits and debits stay completed across reordered files; formatting is normalized, leading zeroes preserved',async()=>{
 const db=await fixture(async db=>{await line(db,100,10,{status:'matched'});await line(db,101,10,{status:'adjusted',amount:-65,reference:'000456',description:'WATER BILL'});});
 try{
  await line(db,102,11,{amount:-65,reference:'000456',description:' water   bill ',hash:'first-row'});
  await line(db,103,11,{description:'qr ref 000123 mgt 15',hash:'last-row'});
  assert.equal(await total(db,'bank_statement_lines'),2);
  const reused=await rows(db,`select * from bank_statement_transactions where statement_import_id='${id(11)}'`);
  assert.ok(reused.every(x=>x.import_result==='ALREADY RECONCILED'));
  assert.equal(reused.find(x=>Number(x.amount)>0).reference_number,'000123');
  await line(db,104,11,{reference:'123'});assert.equal(await total(db,'bank_statement_lines'),3);
 }finally{await db.close();}
});

test('different account, date, sign, amount, reference or description must not merge',async()=>{
 const db=await fixture();try{
  await line(db,100,10);await statement(db,12,9);
  await line(db,101,12,{account:9});
  for(const [i,extra] of [{date:'2026-09-11'},{amount:-480},{amount:481},{reference:'000124'},{description:'QR REF 000123 MGT 16'}].entries())await line(db,102+i,11,extra);
  assert.equal(await total(db,'bank_statement_lines'),7);
  await assert.rejects(line(db,200,12),/Invalid statement import/);
 }finally{await db.close();}
});

test('identical-looking repeated occurrences within a file stay separate; later files reuse occurrences without multiplying them',async()=>{
 const db=await fixture();try{
  await line(db,100,10);await line(db,101,10);
  await line(db,102,11);await line(db,103,11);await line(db,104,11);
  assert.equal(await total(db,'bank_statement_lines'),3);
  assert.equal(Number((await rows(db,`select sum(amount) n from bank_statement_transactions where statement_import_id='${id(11)}'`))[0].n),1440);
  await statement(db,12);await line(db,105,12);await line(db,106,12);await line(db,107,12);
  assert.equal(await total(db,'bank_statement_lines'),3);assert.equal(await total(db,'bank_statement_transaction_members'),8);
 }finally{await db.close();}
});

test('same-import retry is idempotent and a failing bulk insert rolls back reused memberships and new lines together',async()=>{
 const db=await fixture();try{
  await line(db,100,10);await line(db,101,11);await line(db,101,11);
  assert.equal(await total(db,'bank_statement_lines'),1);assert.equal(await total(db,'bank_statement_transaction_members'),2);
  await statement(db,12);
  await assert.rejects(db.exec(`begin;insert into bank_statement_lines(statement_import_id,bank_account_id,transaction_date,amount,reference_number,description,external_hash)values
    ('${id(12)}','${id(1)}','2026-09-10',480,'000123','QR REF 000123 MGT 15','a'),
    ('${id(12)}','${id(1)}','2026-09-10',0,'new','invalid','b');commit;`),/check constraint/);
  await db.exec('rollback');
  assert.equal(await total(db,'bank_statement_lines'),1);assert.equal(await total(db,'bank_statement_transaction_members'),2);
 }finally{await db.close();}
});

test('real multi-row INSERT preserves repeated occurrences before AFTER triggers fire, then reuses them in a second bulk import',async()=>{
 const db=await fixture();try{
  const bulk=statementId=>db.exec(`insert into bank_statement_lines(statement_import_id,bank_account_id,transaction_date,amount,reference_number,description,external_hash)values
    ('${id(statementId)}','${id(1)}','2026-09-10',480,'000123','QR MGT 15','a'),
    ('${id(statementId)}','${id(1)}','2026-09-10',480,'000123','QR MGT 15','b'),
    ('${id(statementId)}','${id(1)}','2026-09-10',20,'000124','Other transfer','c');`);
  await bulk(10);await bulk(11);await bulk(11);
  assert.equal(await total(db,'bank_statement_lines'),3);
  assert.equal(await total(db,'bank_statement_transaction_members'),6);
  assert.equal(Number((await rows(db,`select sum(amount) n from bank_statement_transactions where statement_import_id='${id(11)}'`))[0].n),980);
 }finally{await db.close();}
});

test('date/amount without meaningful identity is not enough; void imports are not reused',async()=>{
 const db=await fixture();try{
  await line(db,100,10,{reference:null,description:'Bank transaction'});await line(db,101,11,{reference:null,description:'Bank transaction'});
  await line(db,102,10);await db.query("update bank_statement_imports set status='void' where id=$1",[id(10)]);
  await line(db,103,11);assert.equal(await total(db,'bank_statement_lines'),4);
 }finally{await db.close();}
});

test('repair fails atomically instead of hiding independently reconciled copies',async()=>{
 const db=new PGlite();try{
  await db.exec(schema);await statement(db,10);await statement(db,11);
  await line(db,100,10,{status:'matched'});await line(db,101,11,{status:'matched'});
  await db.query('insert into bank_reconciliation_matches(statement_line_id,matched_amount)values($1,480),($2,480)',[id(100),id(101)]);
  await assert.rejects(db.exec('begin;'+migration+'commit;'),/independently posted/);await db.exec('rollback');
  assert.equal(await total(db,'bank_reconciliation_matches'),2);
 }finally{await db.close();}
});

test('memberships and security-invoker statement view preserve company access and deny browser writes',async()=>{
 const db=await fixture();try{
  await line(db,100,10);await line(db,101,11);
  await db.exec(`set role authenticated;set test.company='${id(2)}';`);
  assert.equal(await total(db,'bank_statement_transactions'),2);
  await db.exec(`set test.company='${id(99)}'`);assert.equal(await total(db,'bank_statement_transactions'),0);
  await assert.rejects(db.exec(`insert into bank_statement_transaction_members values('${id(11)}','bad','${id(100)}',now())`),/permission denied/);
  await db.exec('reset role;set role anon');await assert.rejects(rows(db,'select * from bank_statement_transactions'),/permission denied/);
 }finally{await db.close();}
});

test('all page totals use membership view, work excludes reused lines, archived imports never flag originals as duplicates',()=>{
 const page=fs.readFileSync(path.join(root,'app/reports/page.tsx'),'utf8'),actions=fs.readFileSync(path.join(root,'app/reports/actions.ts'),'utf8');
 assert.match(page,/!line\.is_reused && line\.status === "unmatched"/);
 assert.match(page,/bank_statement_transactions[\s\S]*?balanceStatementIds/);
 assert.match(actions,/bank_statement_transactions[\s\S]*?importSummary/);
 assert.match(actions,/finalizeBankReconciliation[\s\S]*?bank_statement_transactions/);
 assert.match(fs.readFileSync(path.join(root,'lib/accounting/tenant-reconciliation-data.ts'),'utf8'),/filter\(b=>!b\.duplicate_of_line_id\)/);
 assert.match(migration,/pg_advisory_xact_lock/);
 assert.doesNotMatch(migration,/\b(?:insert into|update|delete from) public\.(?:payments|receipts|rent_bills|bank_reconciliation_matches)\b/i);
});
