// Real PostgreSQL execution against disposable in-memory fixtures, never production.
// Covers the general QR reconciliation rule: property+room+bank-date resolves
// the tenancy that occupied the room at that time (not necessarily the
// current occupant), finds or creates that tenancy's rental invoice, and
// reconciles the bank line to it via the existing apply_bank_to_room_invoice.
const {PGlite}=require('@electric-sql/pglite');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const applyBankToRoomInvoiceSql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260926000000_capture_apply_bank_to_room_invoice.sql'),'utf8');
const tenancyForRoomAtDateSql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260926020000_tenancy_for_room_at_date.sql'),'utf8');
const createAndApplySql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20260926030000_create_and_apply_room_invoice_from_bank.sql'),'utf8');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let db;
test.before(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create type public.bill_status as enum ('draft','unpaid','partial','paid','cancelled','submitted','pending_verification','rejected','overdue','upcoming','due_today','partially_paid','waived');
    create table profiles(id uuid primary key,role text);
    create table tenants(id uuid primary key,profile_id uuid);
    create table properties(id uuid primary key,company_id uuid,property_code text);
    create table rooms(id uuid primary key,property_id uuid,room_number text,status text,current_tenancy_id uuid);
    create table tenancies(id uuid primary key,company_id uuid,organization_id uuid,tenant_id uuid,room_id uuid,property_id uuid,unit_id uuid,
      monthly_rental numeric,monthly_rent numeric,due_day int,rent_due_day int,status text,billing_status text,
      start_date date,end_date date,contract_start date,contract_end date,tenancy_start_date date,tenancy_end_date date,check_in_date date,checkout_date date);
    create table tenant_records(id uuid primary key,tenancy_id uuid,company_id uuid,full_name text,created_at timestamptz default now());
    create table rent_bills(id uuid primary key default gen_random_uuid(),organization_id uuid,tenancy_id uuid,tenant_id uuid,property_id uuid,unit_id uuid,room_id uuid,
      tenant_record_id uuid,bill_month date,due_date date,amount numeric,paid_amount numeric default 0,status public.bill_status default 'unpaid',
      invoice_source text default 'automatic',tenant_facing boolean not null default true,invoice_number text default '',removed_at timestamptz,deposit_amount numeric default 0,
      created_by uuid,updated_at timestamptz default now(),unique(tenancy_id,bill_month));
    create table payment_submissions(id uuid primary key,property_id uuid,room_id uuid,bill_month date,verification_status text,amount numeric,payment_date date);
    create table payments(id uuid primary key default gen_random_uuid(),company_id uuid,organization_id uuid,tenant_id uuid,tenancy_id uuid,property_id uuid,unit_id uuid,room_id uuid,
      rent_bill_id uuid,category text,amount numeric,payment_date date,payment_method text,reference_number text,notes text,status text,
      recorded_by uuid,verified_by uuid,verified_at timestamptz,origin_bank_line_id uuid,smart_meter_top_up_request_id uuid,reversed_at timestamptz,payment_submission_id uuid);
    create table rental_invoice_line_items(id uuid primary key default gen_random_uuid(),rent_bill_id uuid,category text,description text,amount numeric,
      created_by uuid,origin_bank_line_id uuid,smart_meter_top_up_request_id uuid);
    create table bank_statement_imports(id uuid primary key,company_id uuid,status text,period_start date);
    create table bank_statement_lines(id uuid primary key,statement_import_id uuid,bank_account_id uuid,amount numeric,transaction_date date,reference_number text,description text,status text,updated_at timestamptz default now());
    create table bank_reconciliation_matches(id uuid primary key default gen_random_uuid(),statement_line_id uuid,source_type text,source_id uuid,matched_amount numeric,match_method text,created_by uuid);
    create table accounting_payment_reconciliations(payment_record_id uuid primary key,company_id uuid,bank_transaction_id uuid unique,reconciliation_status text,reconciled_at timestamptz,reconciled_by uuid,updated_at timestamptz default now());
    create table accounting_audit_logs(company_id uuid,entity_type text,entity_id uuid,action text,after_data jsonb,reason text,performed_by uuid);
    create table rent_bill_audit_logs(bill_id uuid,action text,performed_by uuid,old_status text,new_status text,old_paid_amount numeric,new_paid_amount numeric,reason text);
    create table accounting_periods(company_id uuid,period_start date,period_end date,status text);
    create table smart_meter_top_up_requests(id uuid primary key,property_id uuid,room_id uuid,tenancy_id uuid,bill_month date,amount numeric,status text,rent_bill_id uuid,payment_date date,updated_at timestamptz);

    create or replace function public.reconcile_existing_tenant_payment(p_company uuid, p_line uuid, p_payment uuid, p_actor uuid)
    returns uuid language plpgsql set search_path to 'public' as $function$
    declare
      l public.bank_statement_lines%rowtype; match_id uuid; statement_month date; payment_month date;
    begin
      perform pg_advisory_xact_lock(hashtextextended(p_company::text,1801));
      if not exists (select 1 from public.profiles where id=p_actor and role in ('super_admin','admin','owner')) then
        raise exception 'Not authorized'; end if;
      select l0.* into l from public.bank_statement_lines l0
        join public.bank_statement_imports s on s.id=l0.statement_import_id
        where l0.id=p_line and s.company_id=p_company and s.status='in_progress' for update of l0;
      if l.id is null or l.amount<=0 or l.status<>'unmatched' then
        raise exception 'Possible duplicate transaction. Please review.'; end if;
      select date_trunc('month', s.period_start)::date into statement_month
        from public.bank_statement_lines l0 join public.bank_statement_imports s on s.id=l0.statement_import_id
        where l0.id=p_line and s.company_id=p_company;
      select date_trunc('month', p.payment_date)::date into payment_month from public.payments p where p.id=p_payment and p.company_id=p_company;
      if payment_month is null or statement_month is null or payment_month<>statement_month then
        raise exception 'Payment must be from the same statement month. No match was created.'; end if;
      if exists (select 1 from public.payments p join public.rent_bills b on b.id=p.rent_bill_id
        where p.id=p_payment and date_trunc('month', b.bill_month)::date is distinct from statement_month) then
        raise exception 'Rental invoice must be from the same statement month. No match was created.'; end if;
      if exists (select 1 from public.accounting_payment_reconciliations where payment_record_id=p_payment and bank_transaction_id is not null) then
        raise exception 'Possible duplicate transaction. Please review.'; end if;
      insert into public.bank_reconciliation_matches(statement_line_id, source_type, source_id, matched_amount, match_method, created_by)
        values(p_line,'payment',p_payment,l.amount,'manual',p_actor) returning id into match_id;
      insert into public.accounting_payment_reconciliations(payment_record_id, company_id, bank_transaction_id, reconciliation_status, reconciled_at, reconciled_by)
        values(p_payment,p_company,p_line,'RECONCILED',now(),p_actor)
        on conflict(payment_record_id) do update set bank_transaction_id=p_line,reconciliation_status='RECONCILED',reconciled_at=now(),reconciled_by=p_actor,updated_at=now();
      update public.bank_statement_lines set status='matched',updated_at=now() where id=p_line;
      insert into public.accounting_audit_logs(company_id, entity_type, entity_id, action, after_data, performed_by, reason)
        values(p_company,'payment_reconciliation',match_id,'reconciled',jsonb_build_object('bank_transaction_id',p_line,'payment_record_id',p_payment),p_actor,
          'Linked existing payment only. No receipt, payment, AR or journal created.');
      return match_id;
    end;
    $function$;
  `);
  await db.exec(applyBankToRoomInvoiceSql);
  await db.exec(tenancyForRoomAtDateSql);
  await db.exec(createAndApplySql);
});
test.after(async()=>{await db?.close()});
const admin=id(1);
async function truncateAll(){
  await db.exec(`truncate profiles,tenants,properties,rooms,tenancies,tenant_records,rent_bills,payment_submissions,payments,rental_invoice_line_items,
    bank_statement_imports,bank_statement_lines,bank_reconciliation_matches,accounting_payment_reconciliations,accounting_audit_logs,
    rent_bill_audit_logs,accounting_periods,smart_meter_top_up_requests cascade;`);
  await db.exec(`insert into profiles values('${admin}','admin');
    insert into properties values('${id(10)}','${id(15)}','MGT');
    insert into rooms(id,property_id,room_number,status) values('${id(11)}','${id(10)}','12','occupied');
    insert into bank_statement_imports(id,company_id,status,period_start) values('${id(14)}','${id(15)}','in_progress','2026-09-01');`);
}
async function bank(n,amount,transactionDate='2026-09-15',reference='',description='MGT 12'){
  await db.query(`insert into bank_statement_lines(id,statement_import_id,bank_account_id,amount,transaction_date,reference_number,description,status)
    values($1,'${id(14)}','${id(17)}',$2,$3,$4,$5,'unmatched')`,[id(n),amount,transactionDate,reference,description]);
}
async function tenancy(n,{roomId=id(11),start,end=null,status='active',rent=480}={}){
  await db.query(`insert into tenants(id,profile_id) values($1,$2)`,[id(900+n),id(1900+n)]);
  await db.query(`insert into tenancies(id,company_id,room_id,property_id,tenant_id,monthly_rental,status,billing_status,check_in_date,checkout_date)
    values($1,'${id(15)}',$2,'${id(10)}',$3,$4,$5,'active',$6,$7)`,[id(n),roomId,id(900+n),rent,status,start,end]);
  await db.query(`insert into tenant_records(id,tenancy_id,company_id,full_name) values($1,$2,'${id(15)}',$3)`,[id(920+n),id(n),`Tenant ${n}`]);
}
const createAndApply=(line=30,kind='monthly_rent')=>db.query(`select create_and_apply_room_invoice_from_bank($1,$2,$3,$4)`,[id(15),admin,id(line),kind]);
const rows=async(sql)=>(await db.query(sql)).rows;

test("room changed tenants mid-year: an August transaction resolves the OLD tenant, not the room's current occupant",async()=>{
  await truncateAll();
  await tenancy(1,{start:'2026-01-01',end:'2026-08-31',status:'ended',rent:480});
  await tenancy(2,{start:'2026-09-01',end:null,status:'active',rent:500});
  await db.query(`update rooms set current_tenancy_id='${id(2)}' where id='${id(11)}'`);
  await bank(30,480,'2026-08-15');
  // The August bank statement/period is what the bank line belongs to.
  await db.query(`update bank_statement_imports set period_start='2026-08-01' where id='${id(14)}'`);
  await createAndApply(30);
  const bill=(await rows(`select * from rent_bills where bill_month='2026-08-01'`))[0];
  assert.equal(bill.tenancy_id,id(1),'invoice must be created against the OLD (checked-out) tenancy, not the current occupant');
  assert.equal(bill.tenant_id,id(1901),'invoice uses the portal profile, not the tenancy tenant-record ID');
  assert.equal(bill.tenant_facing,false,"a checked-out tenant's backfilled invoice must never be tenant-facing");
  assert.equal(Number(bill.paid_amount),480);
  assert.equal(bill.status,'paid');
  assert.equal((await rows(`select status from bank_statement_lines where id='${id(30)}'`))[0].status,'matched');
});

test('room changed tenants mid-year: a September transaction resolves the NEW, still-active tenant as a normal tenant-facing invoice',async()=>{
  await truncateAll();
  await tenancy(1,{start:'2026-01-01',end:'2026-08-31',status:'ended',rent:480});
  await tenancy(2,{start:'2026-09-01',end:null,status:'active',rent:500});
  await db.query(`update rooms set current_tenancy_id='${id(2)}' where id='${id(11)}'`);
  await bank(30,500,'2026-09-15');
  await createAndApply(30);
  const bill=(await rows(`select * from rent_bills where bill_month='2026-09-01'`))[0];
  assert.equal(bill.tenancy_id,id(2));
  assert.equal(bill.tenant_facing,true,"the room's current, still-active tenant's invoice must behave normally");
});

test('an existing invoice for the resolved tenancy+month is reused, never duplicated',async()=>{
  await truncateAll();
  await tenancy(1,{start:'2026-01-01',end:null,status:'active',rent:480});
  await db.query(`update rooms set current_tenancy_id='${id(1)}' where id='${id(11)}'`);
  await db.query(`insert into rent_bills(id,tenancy_id,tenant_id,property_id,room_id,bill_month,due_date,amount,status,tenant_facing)
    values('${id(50)}','${id(1)}','${id(901)}','${id(10)}','${id(11)}','2026-09-01','2026-09-05',480,'unpaid',true)`);
  await bank(30,480,'2026-09-10');
  await createAndApply(30);
  const bills=await rows(`select * from rent_bills where tenancy_id='${id(1)}' and bill_month='2026-09-01'`);
  assert.equal(bills.length,1,'must not create a second invoice when one already exists for this tenancy+month');
  assert.equal(bills[0].id,id(50));
  assert.equal(Number(bills[0].paid_amount),480);
});

test('partial bank amount against a fresh invoice leaves the remaining balance available',async()=>{
  await truncateAll();
  await tenancy(1,{start:'2026-01-01',end:null,status:'active',rent:480});
  await db.query(`update rooms set current_tenancy_id='${id(1)}' where id='${id(11)}'`);
  await bank(30,300,'2026-09-10');
  await createAndApply(30);
  const bill=(await rows(`select * from rent_bills where tenancy_id='${id(1)}' and bill_month='2026-09-01'`))[0];
  assert.equal(Number(bill.amount),480);
  assert.equal(Number(bill.paid_amount),300);
  assert.equal(bill.status,'partially_paid');
});

test('no tenancy ever occupied this room on the bank date is rejected, not guessed at',async()=>{
  await truncateAll();
  await tenancy(1,{start:'2026-09-01',end:null,status:'active',rent:480});
  await db.query(`update rooms set current_tenancy_id='${id(1)}' where id='${id(11)}'`);
  await bank(30,480,'2026-01-15'); // long before this tenancy started, and no earlier tenancy exists
  await assert.rejects(createAndApply(30),/tenancy_not_found/);
  assert.equal((await rows(`select * from rent_bills`)).length,0);
});

test('an ambiguous bank reference (no single room code) is rejected',async()=>{
  await truncateAll();
  await tenancy(1,{start:'2026-01-01',end:null,status:'active',rent:480});
  await bank(30,480,'2026-09-10','','no room code here');
  await assert.rejects(createAndApply(30),/wrong_room/);
});

test('draft tenancies (never actually started) are never used to attribute a bank transaction',async()=>{
  await truncateAll();
  await tenancy(1,{start:'2026-01-01',end:null,status:'draft',rent:480});
  await bank(30,480,'2026-09-10');
  await assert.rejects(createAndApply(30),/tenancy_not_found/);
});

test('a bank amount larger than the resolved invoice balance is rejected, nothing changed',async()=>{
  await truncateAll();
  await tenancy(1,{start:'2026-01-01',end:null,status:'active',rent:480});
  await db.query(`update rooms set current_tenancy_id='${id(1)}' where id='${id(11)}'`);
  await bank(30,900,'2026-09-10');
  await assert.rejects(createAndApply(30),/exceeds_balance/);
  assert.equal((await rows(`select * from rent_bills`)).length,0);
});

test('an already-verified payment slip for this room/month blocks direct invoice creation (existing_slip)',async()=>{
  await truncateAll();
  await tenancy(1,{start:'2026-01-01',end:null,status:'active',rent:480});
  await db.query(`update rooms set current_tenancy_id='${id(1)}' where id='${id(11)}'`);
  await db.query(`insert into payment_submissions(id,property_id,room_id,bill_month,verification_status,amount,payment_date)
    values('${id(60)}','${id(10)}','${id(11)}','2026-09-01','verified',480,'2026-09-10')`);
  await bank(30,480,'2026-09-10');
  await assert.rejects(createAndApply(30),/existing_slip/);
  assert.equal((await rows(`select * from rent_bills`)).length,0);
});

test('tenancy_for_room_at_date prefers the checked-out tenancy exactly on its last day, and the next tenancy from its first day',async()=>{
  await truncateAll();
  await tenancy(1,{start:'2026-01-01',end:'2026-08-31',status:'ended',rent:480});
  await tenancy(2,{start:'2026-09-01',end:null,status:'active',rent:500});
  assert.equal((await rows(`select id from tenancy_for_room_at_date('${id(11)}','2026-08-31')`))[0].id,id(1));
  assert.equal((await rows(`select id from tenancy_for_room_at_date('${id(11)}','2026-09-01')`))[0].id,id(2));
  assert.equal((await rows(`select id from tenancy_for_room_at_date('${id(11)}','2027-01-01')`))[0].id,id(2),'an open-ended active tenancy still occupies the room');
  await db.query(`update tenancies set checkout_date='2026-12-31',status='ended' where id='${id(2)}'`);
  const noMatch=await rows(`select * from tenancy_for_room_at_date('${id(11)}','2027-01-01')`);
  assert.equal(noMatch.length,1,'a non-setof composite function called in FROM still returns one all-null row when nothing matches');
  assert.equal(noMatch[0].id,null);
});
