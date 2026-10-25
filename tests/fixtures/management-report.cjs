// In-memory PostgreSQL; synthetic rows only. No environment credentials/network.
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs'),path=require('node:path');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
module.exports=async()=>{
 const db=new PGlite();db.id=id;
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create table companies(id uuid primary key);
 create table profiles(id uuid primary key,role text,registration_status text default 'approved');
 create table properties(id uuid primary key,company_id uuid);
 create table tenants(id uuid primary key,profile_id uuid);
 create table tenancies(id uuid primary key,tenant_id uuid);
 create table tenant_records(id uuid primary key,tenant_id uuid);
 create table payments(id uuid primary key,company_id uuid,property_id uuid,category text,status text,amount numeric,payment_date date,reversed_at timestamptz,payment_submission_id uuid);
 create table rent_bills(id uuid primary key,property_id uuid,tenancy_id uuid,tenant_id uuid,tenant_record_id uuid,due_date date,amount numeric,paid_amount numeric,deposit_amount numeric,status text,removed_at timestamptz,issued_at timestamptz,invoice_date date,bill_month date);
 create table rental_invoice_line_items(id uuid primary key,rent_bill_id uuid,amount numeric);
 create table payment_submissions(id uuid primary key,property_id uuid,amount numeric,verification_status text);
 create table rooms(id uuid primary key,property_id uuid,status text);
 create table maintenance_tickets(id uuid primary key,property_id uuid,status text,urgency text,ticket_type text);
 insert into companies values('${id(1)}'),('${id(2)}');
 insert into profiles values('${id(3)}','super_admin','approved'),('${id(4)}','tenant','approved');
 insert into properties values('${id(10)}','${id(1)}'),('${id(20)}','${id(2)}');
 insert into tenants values('${id(30)}','${id(4)}');insert into tenancies values('${id(31)}','${id(30)}');
 insert into tenant_records values('${id(32)}','${id(30)}');
 insert into payments values
 ('${id(101)}','${id(1)}','${id(10)}','monthly_rent','confirmed',100,'2026-10-25',null,'${id(301)}'),
 ('${id(102)}','${id(1)}','${id(10)}','monthly_rent','confirmed',150,'2026-10-25',null,'${id(301)}'),
 ('${id(103)}','${id(1)}','${id(10)}','monthly_rent','confirmed',200,'2026-10-01',null,null),
 ('${id(104)}','${id(1)}','${id(10)}','monthly_rent','confirmed',400,'2026-09-30',null,null),
 ('${id(105)}','${id(1)}','${id(10)}','monthly_rent','pending',800,'2026-10-25',null,null),
 ('${id(106)}','${id(1)}','${id(10)}','deposit','confirmed',1600,'2026-10-25',null,null),
 ('${id(107)}','${id(1)}','${id(10)}','monthly_rent','confirmed',3200,'2026-10-25',now(),null),
 ('${id(108)}','${id(2)}','${id(20)}','monthly_rent','confirmed',6400,'2026-10-25',null,null),
 ('${id(109)}','${id(1)}','${id(10)}','monthly_rent','confirmed',12800,'2026-10-26',null,null),
 ('${id(110)}','${id(1)}','${id(20)}','monthly_rent','confirmed',25600,'2026-10-25',null,null);
 insert into rent_bills values
 ('${id(201)}','${id(10)}','${id(31)}',null,null,'2026-10-20',500,100,999,'partially_paid',null,'2026-10-01','2026-10-01','2026-10-01'),
 ('${id(202)}','${id(10)}',null,null,'${id(32)}','2026-10-21',100,0,999,'unpaid',null,'2026-10-01','2026-10-01','2026-10-01'),
 ('${id(203)}','${id(10)}','${id(31)}',null,null,'2026-10-25',50,0,0,'unpaid',null,'2026-10-01','2026-10-01','2026-10-01');
 insert into rental_invoice_line_items values('${id(211)}','${id(201)}',25),('${id(212)}','${id(201)}',25);
 insert into payment_submissions values('${id(301)}','${id(10)}',250,'verified'),('${id(302)}','${id(10)}',700,'pending_verification'),('${id(303)}','${id(20)}',900,'pending_verification');
 insert into rooms values('${id(401)}','${id(10)}','occupied'),('${id(402)}','${id(10)}','vacant'),('${id(403)}','${id(10)}','reserved'),('${id(404)}','${id(10)}','maintenance'),('${id(405)}','${id(20)}','occupied');
 insert into maintenance_tickets values('${id(501)}','${id(10)}','submitted','urgent','repair'),('${id(502)}','${id(10)}','waiting_for_parts','normal','maintenance'),('${id(503)}','${id(10)}','closed','urgent','repair'),('${id(504)}','${id(10)}','assigned','urgent','cleaning'),('${id(505)}','${id(20)}','assigned','urgent','repair');
 grant select on all tables in schema public to service_role;`);
 await db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20261025055210_whapi_management_reports.sql'),'utf8'));
 return db;
};
