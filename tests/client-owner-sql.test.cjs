const {PGlite}=require('@electric-sql/pglite');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
let db;const q=async sql=>(await db.query(sql)).rows;
test.before(async()=>{
 db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role;create role authenticator;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create type app_role as enum('super_admin','owner','tenant');
 create schema storage;create table storage.buckets(id text primary key,public boolean,name text,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;create policy all_objects on storage.objects using(true) with check(true);grant usage on schema storage to authenticated;grant all on storage.objects to authenticated;
 create table profiles(id uuid primary key,role text,registration_status text,company_name text,full_name text,identity_number text,phone text,bank_name text,bank_account_holder text,bank_account_number text);
 create table properties(id uuid primary key,company_id uuid,name text,address text,city text);
 create table property_owners(id uuid primary key default gen_random_uuid(),property_id uuid,owner_id uuid,ownership_percentage numeric,start_date date,end_date date,created_by uuid);
 create table rooms(id uuid primary key,property_id uuid,name text,room_number text,status text,monthly_rent numeric);
 create table rent_bills(id uuid primary key,property_id uuid,room_id uuid,due_date date,amount numeric,paid_amount numeric,bill_month date,removed_at timestamptz,status text);
 create table payments(id uuid primary key,property_id uuid,room_id uuid,rent_bill_id uuid,amount numeric,payment_date date,category text,status text,reversed_at timestamptz);
 create table expenses(id uuid primary key,property_id uuid,room_id uuid,amount numeric,tax_amount numeric,expense_date date,charge_to text,status text);
 create table claims(id uuid primary key,property_id uuid,room_id uuid,total_amount numeric,description text);
 create table bank_statement_imports(id uuid primary key,company_id uuid);
 create table bank_statement_lines(id uuid primary key,statement_import_id uuid,amount numeric,status text,transaction_date date,reference_number text);
 create table tenants(id uuid,secret text);
 do $$declare t text;begin foreach t in array array['profiles','properties','property_owners','rooms','rent_bills','payments','expenses','claims','bank_statement_imports','bank_statement_lines','tenants'] loop execute format('alter table %I enable row level security',t);execute format('create policy legacy_access on %I using(true) with check(true)',t);execute format('grant all on %I to authenticated',t);end loop;end$$;`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261022131625_client_owner_portal.sql'),'utf8'));
 await db.exec(`insert into profiles(id,role,registration_status,full_name) values('${id(1)}','super_admin','approved','Admin'),('${id(2)}','client_owner','approved','Owner A'),('${id(3)}','client_owner','approved','Owner B'),('${id(4)}','owner','approved','Existing Owner');
 insert into client_owner_settings(owner_id,enabled) values('${id(2)}',true),('${id(3)}',true);
 insert into properties(id,company_id,name) values('${id(10)}','${id(100)}','A'),('${id(11)}','${id(100)}','B');
 insert into property_owners(property_id,owner_id,start_date) values('${id(10)}','${id(2)}',current_date),('${id(11)}','${id(3)}',current_date);
 insert into rooms values('${id(20)}','${id(10)}','01','01','occupied',600),('${id(21)}','${id(10)}','02','02','vacant',700),('${id(22)}','${id(11)}','01','01','occupied',900);
 insert into rent_bills values('${id(30)}','${id(10)}','${id(20)}','2026-10-01',600,400,'2026-10-01',null,'partial');
 insert into payments values('${id(40)}','${id(10)}','${id(20)}','${id(30)}',400,'2026-10-10','monthly_rent','confirmed',null),('${id(41)}','${id(10)}','${id(20)}',null,1000,'2026-10-10','deposit','confirmed',null),('${id(42)}','${id(11)}','${id(22)}',null,900,'2026-10-10','monthly_rent','confirmed',null);
 insert into tenants values('${id(50)}','TENANT PRIVATE IDENTITY');
 insert into claims values('${id(60)}','${id(10)}','${id(20)}',350,'PRIVATE TECHNICIAN NOTES');
 insert into storage.buckets(id,public) values('private',false),('public',true);
 insert into storage.objects values('private','owner-a.pdf'),('private','owner-b.pdf');`);
});
test.after(async()=>db?.close());
async function asUser(n,fn){await db.exec(`set role authenticated;set test.uid='${id(n)}'`);try{return await fn();}finally{await db.exec('reset role;reset test.uid');}}
const snapshot=()=>q("select client_owner_snapshot('2026-10-01') data");
test('owner A receives only A and no tenant/staff fields; deposits excluded from collections',async()=>{
 const [{data}]=await asUser(2,snapshot);assert.equal(data.properties.length,1);assert.equal(data.properties[0].name,'A');assert.equal(data.rooms.length,2);assert.equal(data.receipts.length,1);assert.equal(Number(data.receipts[0].amount),400);assert.equal(data.collections[0].outstanding,200);assert.equal(data.claims.length,0);assert.doesNotMatch(JSON.stringify(data),/PRIVATE|tenant_id|description|file_path/);
});
test('cross-owner URL property request is denied; B cannot see A',async()=>{
 await assert.rejects(asUser(2,()=>q(`select client_owner_snapshot('2026-10-01','${id(11)}')`)),/Property unavailable/);
 const [{data}]=await asUser(3,snapshot);assert.equal(data.properties[0].name,'B');assert.equal(data.rooms.length,1);
});
test('raw legacy permissive access is denied to clients, unchanged for existing Owner',async()=>{
 assert.equal((await asUser(2,()=>q('select * from tenants'))).length,0);
 assert.equal((await asUser(2,()=>q('select * from claims'))).length,0);
 assert.equal((await asUser(2,()=>q('select * from storage.objects'))).length,0);
 assert.equal((await asUser(4,()=>q('select * from tenants'))).length,1);
 assert.equal((await asUser(2,()=>q('select * from profiles'))).length,1);
});
test('legacy RPCs and direct tables blocked at API boundary; snapshot/profile GET allowed',async()=>{
 for(const p of ['rpc/refresh_tenancy_agreement_expiry','rpc/manage_client_owner','tenants','bank_statement_transactions','rpc/graphql']) await assert.rejects(asUser(2,()=>db.exec(`select set_config('request.path','/${p}',false),set_config('request.method','POST',false);select owner_private.check_request()`)),/Client portal access only/);
 await asUser(2,()=>db.exec("select set_config('request.path','/rpc/client_owner_snapshot',false),set_config('request.method','POST',false);select owner_private.check_request()"));
 await asUser(2,()=>db.exec("select set_config('request.path','/profiles',false),set_config('request.method','GET',false);select owner_private.check_request()"));
});
test('client cannot invoke management RPC, self-enable, rewrite role or publish another owner document',async()=>{
 await assert.rejects(asUser(2,()=>q(`select manage_client_owner('${id(1)}','${id(2)}','settings','{}')`)),/permission denied/);
 await assert.rejects(asUser(2,()=>q('select * from client_owner_settings')),/permission denied/);
 await asUser(2,()=>q("update profiles set role='super_admin'"));assert.equal((await q(`select role from profiles where id='${id(2)}'`))[0].role,'client_owner');
});
test('private document publication is owner-scoped and revocation removes access',async()=>{
 const [{id:doc}]=await q(`select manage_client_owner('${id(1)}','${id(2)}','document','{"property_id":"${id(10)}","title":"Invoice","category":"invoice","bucket":"private","path":"owner-a.pdf","mime":"application/pdf","date":"2026-10-01"}') id`);
 assert.equal((await asUser(2,snapshot))[0].data.documents.length,1);assert.equal((await asUser(3,snapshot))[0].data.documents.length,0);
 await q(`select manage_client_owner('${id(1)}','${id(2)}','revoke_document','{"id":"${doc}"}')`);assert.equal((await asUser(2,snapshot))[0].data.documents.length,0);
});
test('disabled client and non-client cannot get portal projection',async()=>{
 await db.exec(`update client_owner_settings set enabled=false where owner_id='${id(2)}'`);await assert.rejects(asUser(2,snapshot),/Owner portal unavailable/);await db.exec(`update client_owner_settings set enabled=true where owner_id='${id(2)}'`);await assert.rejects(asUser(4,snapshot),/Owner portal unavailable/);
});
test('published claim uses reviewed summary and explicit partial amount, without changing source',async()=>{
 const before=await q('select * from claims');
 await q(`select manage_client_owner('${id(1)}','${id(2)}','share','{"property_id":"${id(10)}","source_type":"claim","source_id":"${id(60)}","title":"Repair","summary":"Cooling restored","reported":"2026-10-18","chargeable":true,"owner_claim_amount":200,"status":"Completed"}')`);
 const [{data}]=await asUser(2,snapshot);assert.equal(data.claims.length,1);assert.equal(data.claims[0].claimed,200);assert.equal(data.claims[0].amount,350);assert.doesNotMatch(JSON.stringify(data),/PRIVATE TECHNICIAN/);assert.deepEqual(await q('select * from claims'),before);
 await assert.rejects(q(`select manage_client_owner('${id(1)}','${id(2)}','share','{"property_id":"${id(10)}","source_type":"claim","source_id":"${id(60)}","title":"Repair","chargeable":true,"owner_claim_amount":400}')`),/approved owner claim amount/);
});
test('payout links existing bank only, prevents duplicates and leaves all financial sources unchanged',async()=>{
 const [{id:doc}]=await q(`select manage_client_owner('${id(1)}','${id(2)}','document','{"property_id":"${id(10)}","title":"Statement","category":"statement","bucket":"private","path":"owner-b.pdf","mime":"application/pdf","date":"2026-10-01"}') id`);
 const [{id:statement}]=await q(`select manage_client_owner('${id(1)}','${id(2)}','statement','{"property_id":"${id(10)}","document_id":"${doc}","period":"2026-10-01","income":600,"collected":400,"outstanding":200,"expenses":0,"maintenance":0,"fee_amount":0,"source_reference":"Approved test statement"}') id`);
 await db.exec(`insert into bank_statement_imports values('${id(70)}','${id(100)}');insert into bank_statement_lines values('${id(71)}','${id(70)}',-400,'matched','2026-10-20','ORIGINAL-REF');`);
 const financial=async()=>Promise.all(['bank_statement_lines','payments','rent_bills','expenses','claims'].map(t=>q(`select * from ${t} order by id`)));
 const before=await financial();
 const payload=JSON.stringify({statement_id:statement,bank_line_id:id(71),amount:400});
 await q(`select manage_client_owner('${id(1)}','${id(2)}','payout','${payload}')`);
 await assert.rejects(q(`select manage_client_owner('${id(1)}','${id(2)}','payout','${payload}')`),/already represented/);
 await assert.rejects(q(`select manage_client_owner('${id(1)}','${id(3)}','payout','${payload}')`),/Statement not found/);
 const [{data}]=await asUser(2,snapshot);assert.equal(data.statements[0].paid,400);assert.equal(data.payouts[0].reference,'ORIGINAL-REF');
 assert.deepEqual(await financial(),before);
 await assert.rejects(q(`update owner_portal_statements set collected=999 where id='${statement}'`),/immutable|Immutable|append|correction/i);
});
