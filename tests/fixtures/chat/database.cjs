// Disposable local SQL fixture. No credentials, production data or network clients.
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs'), path = require('node:path');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
module.exports = async function database({ desks = true } = {}) {
 const db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated;
 create table profiles(id uuid primary key,role text,registration_status text default 'approved',full_name text,organization_id uuid);
 create table properties(id uuid primary key,name text,company_id uuid default '${id(11)}',organization_id uuid);
 create table rooms(id uuid primary key,property_id uuid);
 create table tenancies(id uuid primary key,tenant_id uuid,property_id uuid,room_id uuid,status text);
 create table tenants(id uuid primary key,profile_id uuid);
 create table property_owners(owner_id uuid,property_id uuid,start_date date,end_date date);
 create table client_owner_settings(owner_id uuid,enabled boolean);
 create table company_users(company_id uuid,profile_id uuid,user_id uuid,status text);
 create table companies(id uuid primary key);
 insert into companies values('${id(11)}');
 create schema storage;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated,anon; grant all on storage.objects to authenticated,anon;
 create policy legacy_storage_permissive on storage.objects for all to authenticated using(true) with check(true);
 create table maintenance_tickets(id uuid primary key,property_id uuid,room_id uuid,status text,ticket_number text,tenant_id uuid);
 create table maintenance_ticket_assignments(ticket_id uuid,assigned_to uuid,status text);
 insert into profiles(id,role,full_name) values
 ('${id(1)}','client_owner','Fixture Owner'),('${id(2)}','tenant','Fixture Tenant'),
 ('${id(3)}','admin','Fixture Management'),('${id(4)}','contractor_preview','Fixture Contractor'),
 ('${id(5)}','super_admin','Fixture Admin'),('${id(7)}','client_owner','Unrelated Owner');
 insert into properties(id,name) values('${id(20)}','Synthetic property — local test');
 insert into rooms values('${id(22)}','${id(20)}');
 insert into tenants values('${id(23)}','${id(2)}');
 insert into tenancies values('${id(24)}','${id(23)}','${id(20)}','${id(22)}','active');
 insert into maintenance_tickets values('${id(30)}','${id(20)}','${id(22)}','in_progress','FIXTURE-JOB-1','${id(23)}');
 insert into maintenance_ticket_assignments values('${id(30)}','${id(4)}','accepted');
 insert into property_owners values('${id(1)}','${id(20)}',current_date-10,null);
 insert into client_owner_settings values('${id(1)}',true);
 insert into company_users values('${id(11)}','${id(3)}',null,'active'),('${id(11)}','${id(5)}',null,'active');`);
 await db.exec(fs.readFileSync(path.resolve(__dirname,'../../../supabase/migrations/20261023174901_dekez_in_app_chat_foundation.sql'),'utf8'));
 await db.exec(fs.readFileSync(path.resolve(__dirname,'../../../supabase/migrations/20261024025757_dekez_chat_files_and_access.sql'),'utf8'));
 // The production gateway dependency is supplied by the dedicated gateway suite.
 if (desks) {
  await db.exec('create schema marketplace_private; create function marketplace_private.check_request() returns void language sql as $$select$$;');
  await db.exec(fs.readFileSync(path.resolve(__dirname,'../../../supabase/migrations/20261024060911_dekez_chat_contact_desks.sql'),'utf8'));
 }
 await db.exec(`insert into dekez_chat_private.members(user_id,profile_role,chat_role,enabled,approved_by)
 select id,role,case role when 'client_owner' then 'owner' when 'tenant' then 'tenant' when 'admin' then 'management' when 'super_admin' then 'admin' else 'contractor' end,true,'${id(5)}' from profiles;
 insert into dekez_chat_private.scopes(id,kind,property_id,maintenance_ticket_id) values
 ('${id(40)}','property','${id(20)}',null),('${id(41)}','maintenance','${id(20)}','${id(30)}');
 insert into dekez_chat_private.relationships(id,scope_id,user_a,user_b,authorized_by,reason) values
 ('${id(50)}','${id(41)}','${id(1)}','${id(4)}','${id(5)}','Synthetic job authorization'),
 ('${id(51)}','${id(40)}','${id(1)}','${id(3)}','${id(5)}','Synthetic management authorization'),
 ('${id(52)}','${id(40)}','${id(1)}','${id(2)}','${id(5)}','Deliberately forbidden pair');`);
 await db.exec(`update dekez_chat_private.members set support_dispatcher=true where user_id='${id(5)}';
 update dekez_chat_private.members set support_enabled=true where user_id='${id(3)}';`);
 let queue = Promise.resolve();
 function serial(work) { const result=queue.then(work); queue=result.catch(()=>{}); return result; }
 async function rpc(actor,name,args,service=false) {
  return serial(async()=>{
   if(!/^dekez_chat_[a-z_]+$/.test(name))throw Error('Unexpected fixture RPC');
   await db.exec(`set role ${service?'service_role':'authenticated'}; set test.uid='${id(actor)}'`);
   try {
    const entries=Object.entries(args);
    if(entries.some(([key])=>!/^p_[a-z_]+$/.test(key)))throw Error('Invalid argument');
    const {rows}=await db.query(`select * from public.${name}(${entries.map(([key],i)=>`${key} => $${i+1}`).join(',')})`,entries.map(([,value])=>value));
    return {data:['dekez_chat_bootstrap','dekez_chat_desk_open','dekez_chat_open','dekez_chat_report','dekez_chat_read','dekez_chat_support_manifest','dekez_chat_support_assign','dekez_chat_support_status','dekez_chat_member_setup','dekez_chat_relationship_setup','dekez_chat_relationship_revoke','dekez_chat_file_reserve','dekez_chat_file_uploaded','dekez_chat_file_access'].includes(name)?rows[0]?.[name]:['dekez_chat_send','dekez_chat_evidence','dekez_chat_file_send'].includes(name)?rows[0]:rows,error:null};
   } catch(error) { return {data:null,error:{code:error.code,message:error.message}}; }
   finally { await db.exec('reset role; reset test.uid'); }
  });
 }
 const opened=await rpc(1,'dekez_chat_open',{p_relationship:id(50)});
 if(opened.error)throw Error(opened.error.message);
 const conversation=opened.data;
 await db.query(`insert into dekez_messages(conversation_id,sender_id,seq,client_key,body)
 select $1,$2,n,gen_random_uuid(),'Earlier fixture message '||n from generate_series(1,85) n`,[conversation,id(4)]);
 await db.query('update dekez_conversations set message_count=85 where id=$1',[conversation]);
 await db.query('update dekez_conversation_participants set unread_count=85 where conversation_id=$1 and user_id=$2',[conversation,id(1)]);
 return {rpc,conversation,id,query:(sql,args=[])=>serial(()=>db.query(sql,args)),exec:sql=>serial(()=>db.exec(sql)),as: (n,sql,args=[])=>serial(async()=>{await db.exec(`set role authenticated; set test.uid='${id(n)}'`);try{return await db.query(sql,args);}finally{await db.exec('reset role; reset test.uid');}}),close:()=>db.close()};
};
