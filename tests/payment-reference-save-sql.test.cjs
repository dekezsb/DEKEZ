// Disposable PostgreSQL fixtures only: no portal payments are used for testing.
const { PGlite } = require('@electric-sql/pglite');
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260926132857_payment_slip_inline_bank_reference.sql'), 'utf8');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let db;
test.before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key,role text,global_role text);
    create table properties(id uuid primary key,company_id uuid);
    create table payment_submissions(id uuid primary key,property_id uuid,tenancy_id uuid,tenant_record_id uuid,rent_bill_id uuid,reference_number text,verification_status text,amount numeric,payment_date date,payment_method text,verified_at timestamptz,receipt_url text);
    create table payments(id uuid primary key,payment_submission_id uuid,company_id uuid,reference_number text,amount numeric,payment_date date,status text,reversed_at timestamptz);
    create table audit_logs(company_id uuid,actor_profile_id uuid,action text,entity_table text,entity_id uuid,metadata jsonb);
    create table rent_bills(id uuid primary key,paid_amount numeric,status text);
    create table receipts(id uuid primary key);
    create table journals(id uuid primary key);
    create function verify_payment_folder_slip(uuid,uuid,text,text) returns void language plpgsql as $$ begin
      if (select amount from public.payment_submissions where id=$1)>500 then raise exception 'Amount exceeds balance'; end if;
      update public.payment_submissions set verification_status='verified' where id=$1;
    end; $$;`);
  await db.exec(sql);
});
test.after(async () => db?.close());
async function fixture() {
  await db.exec(`truncate profiles,properties,payment_submissions,payments,audit_logs,rent_bills,receipts,journals;
    insert into profiles values('${id(1)}','super_admin','super_admin'),('${id(2)}','staff','staff');
    insert into properties values('${id(10)}','${id(11)}');
    insert into rent_bills values('${id(12)}',480,'paid');
    insert into payment_submissions values('${id(20)}','${id(10)}','${id(13)}','${id(14)}','${id(12)}',null,'verified',480,'2026-09-01','bank_transfer','2026-09-01','original.png');
    insert into payments values('${id(30)}','${id(20)}','${id(11)}',null,380,'2026-09-01','confirmed',null),('${id(31)}','${id(20)}','${id(11)}',null,100,'2026-09-01','confirmed',null);
    insert into receipts values('${id(40)}'); insert into journals values('${id(41)}');`);
}
const save = (code='00027588',prev=null,actor=1,submission=20) => db.query('select save_payment_bank_reference($1,$2,$3,$4)',[id(submission),id(actor),code,prev]);
const rows = async q => (await db.query(q)).rows;
test('verified backfill updates source and both existing allocations, no financial changes, one audit', async () => {
  await fixture();
  const before = await rows('select to_jsonb(s)-\'reference_number\' as row from payment_submissions s');
  await save();
  assert.equal((await rows('select reference_number from payment_submissions'))[0].reference_number,'00027588');
  assert.deepEqual(await rows('select to_jsonb(s)-\'reference_number\' as row from payment_submissions s'),before);
  assert.deepEqual((await rows('select reference_number from payments')).map(x=>x.reference_number),['00027588','00027588']);
  assert.equal((await rows('select * from payments')).length,2);
  assert.equal((await rows('select * from receipts')).length,1); assert.equal((await rows('select * from journals')).length,1);
  assert.equal(Number((await rows('select paid_amount from rent_bills'))[0].paid_amount),480);
  assert.equal((await rows('select * from audit_logs')).length,1);
  await save(); assert.equal((await rows('select * from audit_logs')).length,1,'idempotent retry');
});
test('bad codes and non-admin callers cannot write', async () => {
  await fixture();
  for(const value of ['', 'QR PAYMENT', '123', '0'.repeat(121), '0001\n22']) await assert.rejects(save(value),/invalid_bank_reference/);
  await assert.rejects(save('00027588',null,2),/Forbidden/);
  assert.equal((await rows('select * from audit_logs')).length,0);
});
test('stale row cannot overwrite another users code', async () => {
  await fixture(); await save(); await assert.rejects(save('00099999'),/reference_changed/);
  assert.equal((await rows('select reference_number from payment_submissions'))[0].reference_number,'00027588');
});
test('same-tenancy duplicate fails atomically; punctuation normalization matches existing folder rule', async () => {
  await fixture();
  await db.exec(`insert into payment_submissions(id,tenancy_id,reference_number,verification_status) values('${id(21)}','${id(13)}','0002-7588','pending_verification');`);
  await assert.rejects(save(),/duplicate_bank_reference/);
  assert.equal((await rows('select reference_number from payment_submissions where id=\''+id(20)+'\''))[0].reference_number,null);
  assert.equal((await rows('select * from audit_logs')).length,0);
});
test('standalone confirmed payment with same company/date/amount/code is blocked', async () => {
  await fixture();
  await db.exec(`insert into payments values('${id(32)}',null,'${id(11)}','00027588',480,'2026-09-01','confirmed',null);`);
  await assert.rejects(save(),/duplicate_bank_reference/);
});
test('legitimate shared QR identifiers across different scopes/date/amount remain allowed', async () => {
  await fixture();
  await db.exec(`insert into payment_submissions(id,property_id,tenancy_id,reference_number,verification_status,amount,payment_date) values('${id(21)}','${id(10)}','${id(99)}','QR00027588','verified',100,'2026-08-01');`);
  await save('QR00027588');
  assert.equal((await rows('select * from audit_logs')).length,1);
});
test('rejected duplicate excluded; existing siblings are not competing payments', async () => {
  await fixture();
  await db.exec(`insert into payment_submissions(id,tenancy_id,reference_number,verification_status) values('${id(21)}','${id(13)}','00027588','rejected');`);
  await save(); assert.equal((await rows('select * from audit_logs')).length,1);
});
test('conflicting linked reference cannot silently overwrite history', async () => {
  await fixture(); await db.exec(`update payments set reference_number='00099999' where id='${id(30)}';`);
  await assert.rejects(save(),/reference_conflict/); assert.equal((await rows('select * from audit_logs')).length,0);
});
test('folder verification and reference saving roll back together when allocation fails', async () => {
  await fixture(); await db.exec(`update payment_submissions set verification_status='pending_verification',amount=600 where id='${id(20)}';`);
  await assert.rejects(db.query('select verify_payment_folder_slip_with_reference($1,$2,$3,$4)',[id(20),id(1),'00027588',null]),/exceeds balance/);
  const s=(await rows('select * from payment_submissions'))[0]; assert.equal(s.reference_number,null); assert.equal(s.verification_status,'pending_verification');
  assert.equal((await rows('select * from audit_logs')).length,0);
});
test('normal verification reference writes hit the same duplicate trigger',async()=>{
  await fixture(); await db.exec(`insert into payment_submissions(id,tenancy_id,reference_number,verification_status) values('${id(21)}','${id(13)}','00027588','verified');`);
  await assert.rejects(db.exec(`update payment_submissions set verification_status='verified',reference_number='00027588' where id='${id(20)}'`),/duplicate_bank_reference/);
});
test('reference RPC is service-only, not an authenticated public privilege bypass',async()=>{
  const r=await rows("select has_function_privilege('authenticated','save_payment_bank_reference(uuid,uuid,text,text)','execute') as allowed, has_function_privilege('service_role','save_payment_bank_reference(uuid,uuid,text,text)','execute') as server_allowed");
  assert.equal(r[0].allowed,false); assert.equal(r[0].server_allowed,true);
});
