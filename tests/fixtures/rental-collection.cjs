// Synthetic PostgreSQL only. No network, production data or environment secrets.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
module.exports = async () => {
 const db = new PGlite(); db.id=id;
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create role fixture_migrator nologin createrole createdb bypassrls;
 grant usage,create on schema public to fixture_migrator; set role fixture_migrator;
 create table companies(id uuid primary key);
 create table profiles(id uuid primary key,full_name text,phone text,role text,registration_status text,
 normalized_phone text generated always as (nullif(regexp_replace(coalesce(phone,''),'[^0-9]','','g'),'')) stored);
 create table company_users(id uuid primary key,company_id uuid,user_id uuid,profile_id uuid,role text,status text);
 create table user_module_permissions(profile_id uuid,module_key text,access_level text,primary key(profile_id,module_key));
 create table properties(id uuid primary key,company_id uuid,name text,property_code text);
 create table rooms(id uuid primary key,property_id uuid,room_number text,name text,current_tenancy_id uuid default '${id(21)}');
 create table tenants(id uuid primary key,profile_id uuid,full_name text,phone text);
 create table tenancies(id uuid primary key,tenant_id uuid,company_id uuid,property_id uuid,room_id uuid,status text,billing_status text,checkout_date date);
 create table tenant_records(id uuid primary key,tenant_id uuid);
 create table rent_bills(id uuid primary key,tenancy_id uuid,tenant_id uuid,tenant_record_id uuid,property_id uuid,room_id uuid,
 invoice_number text,due_date date,amount numeric,paid_amount numeric,status text,tenant_facing boolean,issued_at timestamptz,
 invoice_date date,bill_month date,removed_at timestamptz,deposit_amount numeric default 0);
 create table rental_invoice_line_items(id uuid primary key,rent_bill_id uuid,amount numeric);
 create table payment_submissions(id uuid primary key,rent_bill_id uuid,tenancy_id uuid,verification_status text);
 create table payments(id uuid primary key,rent_bill_id uuid,tenancy_id uuid,company_id uuid,property_id uuid,room_id uuid,
 category text,status text,amount numeric,reversed_at timestamptz,payment_submission_id uuid);
 create table whatsapp_conversations(id uuid primary key,normalized_phone text,status text);
 create table rent_reminder_logs(id uuid primary key,tenant_id uuid,channel text,sent_at timestamptz,status text);
 insert into companies values('${id(1)}'),('${id(2)}');
 insert into profiles values('${id(3)}','Synthetic admin','60112222222','super_admin','approved'),('${id(4)}','Synthetic tenant','0191111111','tenant','approved');
 insert into company_users values('${id(9)}','${id(1)}','${id(3)}','${id(3)}','admin','active');
 insert into properties values('${id(10)}','${id(1)}','Synthetic Property','TEST');
 insert into rooms values('${id(11)}','${id(10)}','A1','Room A1');
 insert into tenants values('${id(20)}','${id(4)}','Synthetic tenant','0191111111');
 insert into tenancies values('${id(21)}','${id(20)}','${id(1)}','${id(10)}','${id(11)}','active','active',null);
 grant select on all tables in schema public to service_role;
 alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
 const sql=fs.readFileSync('supabase/migrations/20261028025857_rental_collection_review.sql','utf8');
 const [before,after]=sql.split('create schema dekez_collections_private;');
 if(!before||!after)throw Error('Migration boundary changed');
 await db.exec(before);
 await db.exec('reset role; create schema dekez_collections_private authorization fixture_migrator; set role fixture_migrator;');
 await db.exec(after); await db.exec('reset role');
 let queue=Promise.resolve();
 db.rpcQuery=(query,params)=>{const run=queue.then(async()=>{
  await db.exec('begin; set local role service_role;');
  try{const result=await db.query(query,params);await db.exec('commit');return result;}
  catch(error){await db.exec('rollback');throw error;}
 });queue=run.catch(()=>{});return run;};
 db.bill=async(n=100,days=14,amount=500,paid=0,status='unpaid')=>{
  await db.query(`insert into rent_bills(id,tenancy_id,tenant_id,property_id,room_id,invoice_number,due_date,amount,paid_amount,status,tenant_facing,issued_at,invoice_date,bill_month,deposit_amount)
  values($1,$2,$3,$4,$5,$6,'2026-10-27'::date-$7::integer,$8,$9,$10,true,'2026-01-01','2026-01-01','2026-01-01',999)`,
  [id(n),id(21),id(4),id(10),id(11),'SYNTH-'+n,days,amount,paid,status]);
  if(paid>0)await db.query(`insert into payments values($1,$2,$3,$4,$5,$6,'monthly_rent','confirmed',$7,null,null)`,[id(n+1000),id(n),id(21),id(1),id(10),id(11),paid]);
 };
 return db;
};
