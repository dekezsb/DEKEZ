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

// Shared bank code across rooms (20260927140000): one real transfer may fund several
// rooms/invoices, but the total saved under a code must never exceed the bank line.
const sharedSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260927140000_shared_bank_reference_multi_room_amount_cap.sql'), 'utf8');
// Duplicate key narrowed to the same invoice / payment slot (20261001120000); tenant/person is never the key.
const invoiceKeySql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261001120000_bank_reference_duplicate_key_per_invoice.sql'), 'utf8');
let shared;
test.before(async () => {
  shared = new PGlite();
  await shared.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key,role text,global_role text);
    create table properties(id uuid primary key,company_id uuid);
    create table payment_submissions(id uuid primary key,property_id uuid,tenant_id uuid,tenant_application_id uuid,tenancy_id uuid,tenant_record_id uuid,rent_bill_id uuid,bill_month date,payment_type text,reference_number text,verification_status text,amount numeric,payment_date date,payment_method text,verified_at timestamptz,receipt_url text);
    create table payments(id uuid primary key,payment_submission_id uuid,company_id uuid,tenancy_id uuid,rent_bill_id uuid,category text,reference_number text,amount numeric,payment_date date,status text,reversed_at timestamptz);
    create table audit_logs(company_id uuid,actor_profile_id uuid,action text,entity_table text,entity_id uuid,metadata jsonb);
    create table bank_accounts(id uuid primary key,company_id uuid);
    create table bank_statement_lines(id uuid primary key,bank_account_id uuid,transaction_date date,reference_number text,description text,amount numeric);
    create function verify_payment_folder_slip(uuid,uuid,text,text) returns void language plpgsql as $$ begin end; $$;`);
  await shared.exec(sql); await shared.exec(sharedSql); await shared.exec(invoiceKeySql);
});
test.after(async () => shared?.close());
async function sharedFixture() {
  // Room 2 / Room 3 (RM500 each, separate tenancies and bills) paid by one RM1,000 transfer; one unrelated RM350 slip.
  await shared.exec(`truncate profiles,properties,payment_submissions,payments,audit_logs,bank_accounts,bank_statement_lines;
    insert into profiles values('${id(1)}','super_admin','super_admin');
    insert into properties values('${id(110)}','${id(111)}');
    insert into bank_accounts values('${id(150)}','${id(111)}');
    insert into bank_statement_lines values('${id(160)}','${id(150)}','2026-09-25','112145','DUITNOW TRANSFER',1000);
    insert into payment_submissions(id,property_id,tenant_id,tenancy_id,tenant_record_id,rent_bill_id,bill_month,payment_type,verification_status,amount,payment_date,payment_method) values
      ('${id(120)}','${id(110)}','${id(119)}','${id(121)}','${id(123)}','${id(122)}','2026-09-01','monthly_rent','pending_verification',500,'2026-09-25','bank_transfer'),
      ('${id(130)}','${id(110)}','${id(119)}','${id(131)}','${id(133)}','${id(132)}','2026-09-01','monthly_rent','pending_verification',500,'2026-09-25','bank_transfer'),
      ('${id(140)}','${id(110)}','${id(149)}','${id(141)}','${id(143)}','${id(142)}','2026-09-01','monthly_rent','pending_verification',350,'2026-09-25','bank_transfer');`);
}
const saveShared = (submission, code='112145') => shared.query('select save_payment_bank_reference($1,$2,$3,$4)',[id(submission),id(1),code,null]);
const sharedRows = async q => (await shared.query(q)).rows;
const addSlip = (n, cols) => shared.exec(`insert into payment_submissions(id,property_id,verification_status,payment_date,payment_method,${Object.keys(cols).join(',')}) values('${id(n)}','${id(110)}','pending_verification','2026-09-25','bank_transfer',${Object.values(cols).map(v=>v===null?'null':typeof v==='number'?v:`'${v}'`).join(',')});`);
const refOf = async submission => (await sharedRows(`select reference_number from payment_submissions where id='${id(submission)}'`))[0].reference_number;
test('one bank code may fund two rooms up to the real bank amount', async () => {
  await sharedFixture();
  await saveShared(120); await saveShared(130);
  assert.equal(await refOf(120),'112145'); assert.equal(await refOf(130),'112145');
  assert.equal((await sharedRows('select * from audit_logs')).length,2);
});
test('bank_reference_exceeds_amount: total under one code cannot exceed the bank transaction amount', async () => {
  await sharedFixture();
  await saveShared(120); await saveShared(130);
  await assert.rejects(saveShared(140),/bank_reference_exceeds_amount/);
  assert.equal(await refOf(140),null,'rejected save leaves the slip unchanged');
  assert.equal((await sharedRows('select * from audit_logs')).length,2,'no audit row for the rejected save');
  // Standalone confirmed payments under the same code count toward the cap too.
  await sharedFixture();
  await shared.exec(`insert into payments(id,company_id,reference_number,amount,payment_date,status) values('${id(170)}','${id(111)}','112145',600,'2026-09-25','confirmed');`);
  await assert.rejects(saveShared(120),/bank_reference_exceeds_amount/);
});
test('cap matches the bank line even when its text formats the code with spaces/hyphens', async () => {
  await sharedFixture();
  await shared.exec(`update bank_statement_lines set reference_number=null,description='IBG 112-145 RENT';`);
  await saveShared(120); await saveShared(130);
  await assert.rejects(saveShared(140),/bank_reference_exceeds_amount/);
});
test('same person paying two rooms with one code is allowed even when the slips share a tenant record', async () => {
  await sharedFixture();
  // Room 3's slip carries the same tenant_record_id as Room 2: still two different invoices.
  await shared.exec(`update payment_submissions set tenant_record_id='${id(123)}' where id='${id(130)}';`);
  await saveShared(120); await saveShared(130);
  assert.equal(await refOf(120),'112145'); assert.equal(await refOf(130),'112145');
  assert.equal((await sharedRows('select * from audit_logs')).length,2);
});
test('two different invoices of the same tenancy may share one code within the bank amount', async () => {
  await sharedFixture();
  await addSlip(125,{tenant_id:id(119),tenancy_id:id(121),tenant_record_id:id(123),rent_bill_id:id(127),bill_month:'2026-10-01',payment_type:'monthly_rent',amount:500});
  await saveShared(120); await saveShared(125);
  assert.equal(await refOf(125),'112145');
});
test('the same rent bill receiving the same code twice is duplicate_bank_reference', async () => {
  await sharedFixture();
  await addSlip(125,{tenant_id:id(119),tenancy_id:id(121),tenant_record_id:id(123),rent_bill_id:id(122),bill_month:'2026-09-01',payment_type:'monthly_rent',amount:100});
  await saveShared(120);
  await assert.rejects(saveShared(125),/duplicate_bank_reference/);
  assert.equal(await refOf(125),null);
  // A standalone confirmed payment already carrying the code on the same bill is also a duplicate.
  await sharedFixture();
  await shared.exec(`insert into payments(id,company_id,tenancy_id,rent_bill_id,category,reference_number,amount,payment_date,status) values('${id(171)}','${id(111)}','${id(121)}','${id(122)}','monthly_rent','112-145',100,'2026-09-25','confirmed');`);
  await assert.rejects(saveShared(120),/duplicate_bank_reference/);
  assert.equal((await sharedRows('select * from audit_logs')).length,0);
});
test('payments without an invoice: same slot is a duplicate, a different payment type is not', async () => {
  await sharedFixture();
  await shared.exec(`delete from bank_statement_lines;`);
  const app = { tenant_id:id(119), tenant_application_id:id(190), tenant_record_id:id(123), rent_bill_id:null, bill_month:'2026-09-01' };
  await addSlip(191,{...app,payment_type:'deposit',amount:500});
  await addSlip(192,{...app,payment_type:'deposit',amount:500});
  await addSlip(193,{...app,payment_type:'monthly_rent',amount:500});
  await saveShared(191);
  await assert.rejects(saveShared(192),/duplicate_bank_reference/);
  await saveShared(193);
  assert.equal(await refOf(193),'112145');
});
test('multiple rooms/invoices whose combined total exceeds the bank amount are blocked', async () => {
  await sharedFixture();
  await shared.exec(`update payment_submissions set tenant_record_id='${id(123)}',tenant_id='${id(119)}';`);
  await saveShared(120); await saveShared(130);
  await assert.rejects(saveShared(140),/bank_reference_exceeds_amount/);
  assert.equal(await refOf(140),null);
});
test('rejected slips neither count toward the cap nor make a duplicate', async () => {
  await sharedFixture();
  await shared.exec(`insert into payment_submissions(id,property_id,tenancy_id,rent_bill_id,reference_number,verification_status,amount) values('${id(180)}','${id(110)}','${id(181)}','${id(182)}','112145','rejected',900),('${id(183)}','${id(110)}','${id(121)}','${id(122)}','112145','rejected',500);`);
  await saveShared(120); await saveShared(130);
  assert.equal((await sharedRows('select * from audit_logs')).length,2);
});

// Folder uploads (20261001130000) follow the same invoice/payment-level rule and bank-amount cap.
const folderSql = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261001130000_payment_folder_bank_reference_per_invoice.sql'), 'utf8');
let folder;
test.before(async () => {
  folder = new PGlite();
  await folder.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key,role text,global_role text);
    create table properties(id uuid primary key,company_id uuid);
    create table rent_bills(id uuid primary key,tenancy_id uuid,tenant_record_id uuid,tenant_id uuid,property_id uuid,unit_id uuid,room_id uuid,bill_month date,status text);
    create table payment_submissions(id uuid primary key default gen_random_uuid(),tenant_id uuid,tenant_application_id uuid,tenant_record_id uuid,tenancy_id uuid,rent_bill_id uuid,property_id uuid,unit_id uuid,room_id uuid,bill_month date,bill_type text,payment_type text,
      amount numeric,payment_date date,payment_method text,reference_number text,receipt_url text,verification_status text,verified_at timestamptz,instalment boolean,submission_key uuid,payment_note text,receipt_sha256 text);
    create table payments(id uuid primary key,payment_submission_id uuid,company_id uuid,tenancy_id uuid,rent_bill_id uuid,category text,reference_number text,amount numeric,payment_date date,status text,reversed_at timestamptz);
    create table payment_attachments(payment_submission_id uuid,tenant_id uuid,tenant_record_id uuid,file_path text,file_name text,content_type text);
    create table audit_logs(company_id uuid,actor_profile_id uuid,action text,entity_table text,entity_id uuid,metadata jsonb);
    create table bank_accounts(id uuid primary key,company_id uuid);
    create table bank_statement_lines(id uuid primary key,bank_account_id uuid,transaction_date date,reference_number text,description text,amount numeric);
    create function verify_payment_folder_slip(uuid,uuid,text,text) returns void language plpgsql as $$ begin end; $$;`);
  for (const migration of [sql, sharedSql, invoiceKeySql, folderSql]) await folder.exec(migration);
});
test.after(async () => folder?.close());
async function folderFixture() {
  // One tenancy (Room 2) with Sept + Oct invoices, a second room's tenancy, and one RM1,000 transfer 112145.
  await folder.exec(`truncate properties,rent_bills,payment_submissions,payments,payment_attachments,audit_logs,bank_accounts,bank_statement_lines;
    insert into properties values('${id(210)}','${id(211)}');
    insert into bank_accounts values('${id(250)}','${id(211)}');
    insert into bank_statement_lines values('${id(260)}','${id(250)}','2026-09-25','112145','DUITNOW TRANSFER',1000);
    insert into rent_bills values
      ('${id(220)}','${id(221)}','${id(223)}','${id(219)}','${id(210)}',null,'${id(224)}','2026-09-01','unpaid'),
      ('${id(230)}','${id(221)}','${id(223)}','${id(219)}','${id(210)}',null,'${id(224)}','2026-10-01','unpaid'),
      ('${id(240)}','${id(241)}','${id(243)}','${id(219)}','${id(210)}',null,'${id(244)}','2026-09-01','unpaid');`);
}
let slipNo = 0;
const upload = (bill, amount, extra={}) => { slipNo += 1; const n = String(slipNo).padStart(12,'0');
  return folder.query('select record_payment_folder_slip($1,$2,$3::jsonb)',[id(bill),id(1),JSON.stringify({ key:`10000000-0000-4000-8000-${n}`, amount, purpose:'monthly_rent', date:'2026-09-25',
    reference:'112145', hash:n.padStart(64,'a'), path:`fixture/${n}.png`, file_name:`${n}.png`, content_type:'image/png', ...extra })]); };
const folderRows = async q => (await folder.query(q)).rows;
const folderCounts = async () => ({ slips:(await folderRows('select * from payment_submissions')).length,
  attachments:(await folderRows('select * from payment_attachments')).length, audits:(await folderRows(`select * from audit_logs where action='payment_folder_slip_added'`)).length });
test('folder upload: two different invoices of the same tenancy may share one bank code within the bank amount', async () => {
  await folderFixture();
  await upload(220,500); await upload(230,500);
  assert.deepEqual((await folderRows('select rent_bill_id,reference_number from payment_submissions order by bill_month')).map(r=>[r.rent_bill_id,r.reference_number]),
    [[id(220),'112145'],[id(230),'112145']]);
});
test('folder upload: the same invoice receiving the same bank code twice is a duplicate and rolls back', async () => {
  await folderFixture();
  await upload(220,300);
  await assert.rejects(upload(220,200,{reference:'112-145'}),/duplicate_bank_reference/);
  assert.deepEqual(await folderCounts(),{slips:1,attachments:1,audits:1});
});
test('folder upload: invoices whose combined total exceeds the bank amount are blocked and roll back', async () => {
  await folderFixture();
  await upload(220,500); await upload(240,400);
  await assert.rejects(upload(230,200),/bank_reference_exceeds_amount/);
  assert.deepEqual(await folderCounts(),{slips:2,attachments:2,audits:2});
});
test('folder upload: rejected slips neither count nor duplicate; the same file is still blocked', async () => {
  await folderFixture();
  await folder.exec(`insert into payment_submissions(tenancy_id,rent_bill_id,property_id,reference_number,verification_status,amount,receipt_sha256) values('${id(221)}','${id(220)}','${id(210)}','112145','rejected',900,'${'f'.repeat(64)}');`);
  await upload(220,500); await upload(230,500);
  assert.equal((await folderRows(`select * from payment_submissions where verification_status<>'rejected'`)).length,2);
  const live = (await folderRows(`select receipt_sha256 from payment_submissions where rent_bill_id='${id(230)}'`))[0].receipt_sha256;
  await assert.rejects(upload(220,100,{reference:'',hash:live}),/Duplicate payment slip/);
});
