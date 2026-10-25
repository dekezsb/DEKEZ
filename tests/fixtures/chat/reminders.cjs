// Disposable synthetic sources for reminder SQL and browser tests. Never production.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async function installReminderFixture(db) {
 const id=db.id;
 await db.exec(`create or replace function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('test.uid',true),''))::uuid$$;
 grant usage on schema auth to service_role;
 alter table tenancies add column checkout_date date,add column billing_status text default 'active',add column company_id uuid default '${id(11)}',add column tenancy_end_date date default '2026-10-31',add column contract_end date,add column end_date date;
 create table rent_bills(id uuid primary key,tenancy_id uuid references tenancies(id),tenant_id uuid,property_id uuid,room_id uuid,due_date date,amount numeric,paid_amount numeric,status text,tenant_facing boolean,removed_at timestamptz,invoice_number text);
 create table payments(id uuid primary key default gen_random_uuid(),rent_bill_id uuid references rent_bills(id),amount numeric,status text,reversed_at timestamptz);
 create table payment_submissions(id uuid primary key default gen_random_uuid(),rent_bill_id uuid references rent_bills(id),verification_status text);
 create table tenancy_agreements(id uuid primary key,tenancy_id uuid references tenancies(id),status text,term_start_date date,term_end_date date,version_number integer,rendered_content text,signed_at timestamptz,admin_rejected_at timestamptz,replacement_agreement_id uuid);
 create table tenancy_renewals(id uuid primary key default gen_random_uuid(),tenancy_id uuid references tenancies(id),new_start_date date,decision_status text,renewal_status text);
 insert into rent_bills values('${id(200)}','${id(24)}','${id(2)}','${id(20)}','${id(22)}','2026-10-31',500,0,'unpaid',true,null,'INV-FIXTURE');
 insert into dekez_chat_private.relationships(id,scope_id,user_a,user_b,authorized_by,reason)
 values('${id(55)}','${id(40)}','${id(2)}','${id(5)}','${id(5)}','Synthetic Admin tenant chat');`);
 const opened=await db.rpc(2,'dekez_chat_open',{p_relationship:id(55)});assert.equal(opened.error,null);
 await db.exec(fs.readFileSync(path.resolve(__dirname,'../../../supabase/migrations/20261024160904_dekez_chat_tenant_reminders.sql'),'utf8'));
 return opened.data;
};
