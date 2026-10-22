const {PGlite}=require('@electric-sql/pglite');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const migration=fs.readFileSync(path.join(root,'supabase/migrations/20261022123241_claimable_expense_verification.sql'),'utf8');
let db;const rows=async sql=>(await db.query(sql)).rows;
test.before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create schema storage;
 create table storage.objects(bucket_id text,name text);
 create table bank_statement_lines(id uuid primary key,company_id uuid,amount numeric,status text,duplicate_of_line_id uuid,statement_import_id uuid,transaction_date date,reference_number text);
 create table bank_statement_imports(id uuid primary key,status text);
 create table bank_reconciliation_matches(statement_line_id uuid,source_type text,source_id uuid,matched_amount numeric,match_method text,created_by uuid);
 create table companies(id uuid primary key,created_by uuid);
 create table profiles(id uuid primary key,role text);
 create table company_users(company_id uuid,user_id uuid,profile_id uuid,status text);
 create table user_module_permissions(profile_id uuid,module_key text,access_level text);
 create table expense_categories(id uuid primary key,company_id uuid);
 create table properties(id uuid primary key,company_id uuid);
 create table units(id uuid primary key,property_id uuid);
 create table rooms(id uuid primary key,property_id uuid,unit_id uuid);
 create table maintenance_tickets(id uuid primary key,property_id uuid);
 create table claims(id uuid primary key,company_id uuid,property_id uuid,status text,funding_source text,submitted_by uuid,updated_at timestamptz);
 create table accounting_accounts(id uuid primary key,company_id uuid,system_key text,account_type text,is_active boolean);
 create table accounting_periods(company_id uuid,period_start date,period_end date,status text);
 create table accounting_audit_logs(company_id uuid,entity_type text,entity_id uuid,action text,before_data jsonb,after_data jsonb,performed_by uuid,reason text);
 create table expenses(id uuid primary key,company_id uuid,property_id uuid,unit_id uuid,room_id uuid,maintenance_ticket_id uuid,claim_id uuid unique,category_id uuid,expense_date date,amount numeric,tax_amount numeric,supplier text,description text,paid_by uuid,payment_method text,funding_source text,charge_to text,status text,payment_status text,tax_claimable boolean,receipt_number text,uploaded_by uuid,rejection_reason text,verified_by uuid,verified_at timestamptz,paid_at timestamptz,reimbursement_source text,reimbursed_at timestamptz,updated_at timestamptz default now());
 create table expense_attachments(expense_id uuid,file_path text,file_name text,content_type text,uploaded_by uuid);
 create table staff_reimbursement_payouts(id uuid primary key default gen_random_uuid(),staff_id uuid,total_amount numeric,payment_source text,paid_on date,reference_number text,notes text,proof_bucket_name text,proof_file_path text,proof_content_type text,recorded_by uuid);
 create table staff_reimbursement_liabilities(id uuid primary key default gen_random_uuid(),claim_id uuid unique,expense_id uuid unique,staff_id uuid,amount numeric,status text,owed_at timestamptz,paid_at timestamptz,payout_id uuid,created_at timestamptz default now(),updated_at timestamptz default now());`);
 const old=fs.readFileSync(path.join(root,'supabase/migrations/20260731021303_complete_staff_ap_liability_ledger.sql'),'utf8');
 await db.exec(old.slice(old.indexOf('create or replace function public.sync_staff'),old.indexOf('insert into public.staff_reimbursement_liabilities (',old.indexOf('revoke all'))));
 await db.exec(migration);
});
test.after(async()=>db.close());
test.beforeEach(async()=>{
 await db.exec('truncate bank_statement_lines,bank_statement_imports,bank_reconciliation_matches');
 await db.exec(`truncate staff_reimbursement_allocations,staff_reimbursement_liabilities,staff_reimbursement_payouts,expenses,expense_attachments,claims,storage.objects,accounting_audit_logs,accounting_periods,profiles,companies,company_users,expense_categories,accounting_accounts,user_module_permissions cascade;
 insert into companies values('${id(1)}','${id(2)}');insert into profiles values('${id(2)}','super_admin'),('${id(3)}','maintenance_staff'),('${id(4)}','tenant');
 insert into company_users values('${id(1)}','${id(3)}',null,'active');
 insert into expense_categories values('${id(5)}','${id(1)}');
 insert into accounting_accounts values('${id(6)}','${id(1)}','staff_reimbursement_payable','liability',true);
 insert into storage.objects values('expense-receipts','${id(3)}/${id(10)}/receipt.pdf'),('reimbursement-proofs','proof.pdf');`);
});
const bill=(overrides={})=>({expense_date:'2026-10-22',amount:500,tax_amount:0,funding_source:'staff_personal',paid_by:id(3),payment_method:'cash',charge_to:'company',...overrides});
async function submit(b=bill(),actor=3){return db.query('select submit_expense_bill($1,$2,$3,$4,$5)',[id(10),id(1),id(actor),b,{file_path:`${id(3)}/${id(10)}/receipt.pdf`,file_name:'receipt.pdf',content_type:'application/pdf'}]);}
async function verify(b=bill({category_id:id(5)}),actor=2){const e=(await rows('select * from expenses'))[0];return db.query("select review_expense_bill($1,$2,$3,'verified',$4,'')",[id(10),id(actor),e.updated_at,b]);}
async function payout(amount,n=20){return db.query("select record_staff_reimbursement_partial($1,$2,$3,'company_bank','2026-10-22','REF','test','reimbursement-proofs','proof.pdf','application/pdf',$4)",[id(n),id(3),[{id:(await rows('select id from staff_reimbursement_liabilities'))[0].id,amount}],id(2)]);}
test('receipt/date/amount with no category, ticket or claim submits pending and posts no payable',async()=>{await submit();assert.equal((await rows('select status from expenses'))[0].status,'pending_verification');assert.equal((await rows('select * from staff_reimbursement_liabilities')).length,0);await submit();assert.equal((await rows('select * from expenses')).length,1);});
test('verification requires category; same existing expense creates one payable without Bank or second expense',async()=>{await submit();await assert.rejects(verify(bill()),/category_required/);await verify();assert.equal((await rows('select amount from staff_reimbursement_liabilities'))[0].amount,'500');await assert.rejects(verify(),/changed_or_posted/);assert.equal((await rows('select * from expenses')).length,1);});
test('500 less 300 partial reimbursement leaves 200; second 200 settles; retries never duplicate',async()=>{await submit();await verify();await payout(300);let b=(await rows('select * from staff_reimbursement_balances'))[0];assert.equal(Number(b.amount),200);assert.equal(Number(b.reimbursed_amount),300);assert.equal((await rows('select status from expenses'))[0].status,'verified');await payout(300);assert.equal((await rows('select * from staff_reimbursement_payouts')).length,1);await payout(200,21);b=(await rows('select * from staff_reimbursement_balances'))[0];assert.equal(Number(b.amount),0);assert.equal(b.status,'paid');assert.equal(Number((await rows('select amount from expenses'))[0].amount),500);assert.equal((await rows('select * from expenses')).length,1);});
test('overpayment, duplicate selected bill, missing proof and locked period roll back',async()=>{await submit();await verify();await assert.rejects(payout(501),/invalid_partial_amount/);await db.exec("delete from storage.objects where bucket_id='reimbursement-proofs'");await assert.rejects(payout(100),/proof_required/);await db.exec(`insert into accounting_periods values('${id(1)}','2026-10-01','2026-10-31','locked')`);await assert.rejects(payout(100),/locked/);assert.equal((await rows('select * from staff_reimbursement_payouts')).length,0);});
test('paid bill amounts/payee/history and settlement allocations cannot be overwritten',async()=>{await submit();await verify();await payout(300);await assert.rejects(db.exec('update expenses set amount=1000'),/immutable/);await assert.rejects(db.exec('delete from staff_reimbursement_allocations'),/immutable/);});
test('company paid follows existing cash/payment flow and creates no staff liability',async()=>{await submit(bill({funding_source:'company_cash',paid_by:null}));await verify(bill({funding_source:'company_cash',category_id:id(5),paid_by:null}));assert.equal((await rows('select payment_status from expenses'))[0].payment_status,'paid');assert.equal((await rows('select * from staff_reimbursement_liabilities')).length,0);});
test('tenant, foreign claimant, staff self-approval and public RPC access fail',async()=>{await assert.rejects(submit(bill(),4),/not_authorized/);await assert.rejects(submit(bill({paid_by:id(4)})),/invalid_claimant/);await submit();await assert.rejects(verify(undefined,3),/not_authorized/);assert.equal((await rows("select has_function_privilege('authenticated','submit_expense_bill(uuid,uuid,uuid,jsonb,jsonb)','EXECUTE') ok"))[0].ok,false);});
test('frontend requires receipt/date but not category/ticket; admin category has explicit blank choice',()=>{const form=fs.readFileSync(path.join(root,'components/expenses/add-expense-form.tsx'),'utf8');assert.match(form,/name="categoryId">/);assert.match(form,/name="maintenanceTicketId">/);assert.match(form,/name="receipt"\s+required/);assert.match(form,/Staff \/ Director - Claimable/);const page=fs.readFileSync(path.join(root,'app/expenses/page.tsx'),'utf8');assert.match(page,/Choose category before verifying/);assert.match(page,/Claimable Expenses/);assert.match(page,/Outstanding Claims/);assert.match(page,/Partially Reimbursed/);});

async function bankSettlement(){
 const liability=(await rows('select id from staff_reimbursement_liabilities'))[0].id;
 return db.query('select settle_staff_claims_from_bank($1,$2,$3,$4,$5)',[id(30),id(2),id(3),[liability],'proof.pdf']);
}
async function bankFixture(){
 await submit();await verify();
 await db.exec(`insert into bank_statement_imports values('${id(31)}','in_progress');insert into bank_statement_lines values('${id(30)}','${id(1)}',-300,'unmatched',null,'${id(31)}','2026-10-22','BANK-300');`);
}
test('bank partial settlement consumes existing debit once; leaves 200 AP, 500 expense and same Bank source',async()=>{
 await bankFixture();await bankSettlement();
 assert.equal(Number((await rows('select amount from staff_reimbursement_balances'))[0].amount),200);
 const bank=await rows('select * from bank_statement_lines');assert.equal(bank.length,1);assert.equal(Number(bank[0].amount),-300);assert.equal(bank[0].reference_number,'BANK-300');assert.equal(bank[0].status,'matched');
 assert.equal((await rows('select * from bank_reconciliation_matches')).length,1);
 assert.equal(Number((await rows('select amount from expenses'))[0].amount),500);
 await assert.rejects(bankSettlement(),/bank_line_unavailable/);
 assert.equal((await rows('select * from staff_reimbursement_payouts')).length,1);
});
test('failure to save bank match rolls back the payout and AP allocation atomically',async()=>{
 await bankFixture();await db.exec(`create function reject_test_match() returns trigger language plpgsql as $$begin raise exception 'test_failure';end$$;create trigger test_match_fail before insert on bank_reconciliation_matches for each row execute function reject_test_match();`);
 try {await assert.rejects(bankSettlement(),/test_failure/);assert.equal((await rows('select * from staff_reimbursement_payouts')).length,0);assert.equal(Number((await rows('select amount from staff_reimbursement_balances'))[0].amount),500);assert.equal((await rows('select status from bank_statement_lines'))[0].status,'unmatched');}
 finally {await db.exec('drop trigger test_match_fail on bank_reconciliation_matches;drop function reject_test_match()');}
});
test('duplicate bill selections, stale review version and missing receipt are rejected',async()=>{
 await submit();await assert.rejects(db.query("select review_expense_bill($1,$2,'2000-01-01','verified',$3,'')",[id(10),id(2),bill({category_id:id(5)})]),/changed_or_posted/);
 await verify();const liability=(await rows('select id from staff_reimbursement_liabilities'))[0].id;
 await assert.rejects(db.query("select record_staff_reimbursement_partial($1,$2,$3,'company_bank','2026-10-22','REF','','reimbursement-proofs','proof.pdf','application/pdf',$4)",[id(20),id(3),[{id:liability,amount:100},{id:liability,amount:100}],id(2)]),/duplicate_liability/);
 await db.exec('delete from expense_attachments');await assert.rejects(payout(100),/receipt_required/);
});
test('legacy paid liabilities stay settled without backfill; original balances remain unchanged',async()=>{
 await submit();await verify();await db.exec("update staff_reimbursement_liabilities set status='paid'");
 assert.equal(Number((await rows('select amount from staff_reimbursement_balances'))[0].amount),0);
 assert.equal(Number((await rows('select original_amount from staff_reimbursement_balances'))[0].original_amount),500);
 assert.equal((await rows('select * from staff_reimbursement_allocations')).length,0);
});
test('historical report balance respects reimbursement dates and never changes original expense',()=>{
 const ts=require('typescript'),Module=require('node:module');
 const m=new Module(path.join(root,'lib/accounting/claim-payables.ts'));m.paths=module.paths;
 m.require=()=>({allReportRows:()=>{throw new Error('no database calls expected')}});
 m._compile(ts.transpileModule(fs.readFileSync(m.id,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,m.id);
 const settlements=[{amount:300,date:'2026-10-22',source:'company_bank'},{amount:200,date:'2026-11-01',source:'company_cash'}];
 assert.equal(m.exports.claimBalanceAt(500,settlements,'2026-10-21'),500);
 assert.equal(m.exports.claimBalanceAt(500,settlements,'2026-10-31'),200);
 assert.equal(m.exports.claimBalanceAt(500,settlements,'2026-11-01'),0);
});
test('a completed partial payout refreshes its form identity for the next reimbursement',()=>{
 const page=fs.readFileSync(path.join(root,'app/expenses/page.tsx'),'utf8');
 assert.match(page,/key=\{`\$\{staffId\}:\$\{group\.items\.map/);
 assert.match(page,/requestId=\{randomUUID\(\)\}/);
 const form=fs.readFileSync(path.join(root,'components/maintenance/staff-reimbursement-payout-form.tsx'),'utf8');
 assert.doesNotMatch(form,/crypto\.randomUUID/);
 assert.match(form,/name="payoutRequestId" type="hidden" value=\{requestId\}/);
});
test('report payout embeds identify their FK rather than the new many-to-many allocation route',()=>{
 const source=fs.readFileSync(path.join(root,'lib/accounting/claim-payables.ts'),'utf8');
 assert.match(source,/staff_reimbursement_payouts!staff_reimbursement_liabilities_payout_id_fkey/);
 assert.match(source,/staff_reimbursement_payouts!staff_reimbursement_allocations_payout_id_fkey/);
 assert.doesNotMatch(source,/staff_reimbursement_payouts\(paid_on/);
});
