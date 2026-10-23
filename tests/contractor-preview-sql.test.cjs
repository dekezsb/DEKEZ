const {PGlite}=require('@electric-sql/pglite');
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
let db; const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const q=async sql=>(await db.query(sql)).rows;
async function asUser(n,fn){await db.exec(`set role authenticated;set test.uid='${id(n)}'`);try{return await fn();}finally{await db.exec('reset role;reset test.uid');}}
test.before(async()=>{
 db=new PGlite(); await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create role authenticator;
 create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
 create type public.app_role as enum('super_admin','tenant','client_owner');
 create table auth.users(id uuid primary key,raw_app_meta_data jsonb,phone text,created_at timestamptz default now(),banned_until timestamptz);
 create table profiles(id uuid primary key,role text,full_name text,global_role public.app_role,phone text,registration_status text,updated_at timestamptz);
 create table tenants(id uuid,secret text,phone text);create table payments(id uuid,amount numeric);
 create table audit_logs(action text,entity_table text,entity_id uuid,metadata jsonb);
 create schema storage;create table storage.objects(name text);
 create table public.auth_login_rate_limits(phone_hash text primary key,failed_attempts integer,window_started_at timestamptz,locked_until timestamptz,updated_at timestamptz);
 grant all on public.auth_login_rate_limits to service_role;
 grant usage on schema storage to authenticated;
 do $$declare t text;begin foreach t in array array['public.profiles','public.tenants','public.payments','public.auth_login_rate_limits','storage.objects'] loop
 execute 'alter table '||t||' enable row level security';execute 'create policy legacy_access on '||t||' using(true) with check(true)';execute 'grant all on '||t||' to authenticated';end loop;end$$;
 create schema owner_private;create function owner_private.check_request() returns void language plpgsql security definer as $$begin
 if exists(select 1 from public.profiles where id=auth.uid() and role='client_owner') and current_setting('request.path',true)<>'/profiles'
 then raise insufficient_privilege using message='Client portal access only';end if;end$$;
 alter role authenticator set pgrst.db_pre_request='owner_private.check_request';
 insert into profiles(id,role,full_name) values('${id(1)}','contractor_preview','Pilot'),('${id(2)}','super_admin','Admin'),('${id(3)}','client_owner','Owner'),('${id(4)}','tenant','Tenant'),('${id(5)}','tenant','Provisioning');
 insert into auth.users(id,raw_app_meta_data) values('${id(1)}','{"role":"contractor_preview"}'),('${id(5)}','{"role":"contractor_preview"}');
 insert into tenants(id,secret) values('${id(4)}','private');insert into payments values('${id(4)}',500);insert into storage.objects values('private.pdf');`);
 await db.exec(fs.readFileSync('supabase/migrations/20261023075136_contractor_preview_access.sql','utf8'));
});
test.after(async()=>db?.close());
test('pilot and provisioning identity cannot read/write operational rows or private files',async()=>{
 for(const user of [1,5]) for(const table of ['tenants','payments','storage.objects','auth_login_rate_limits'])
 assert.equal((await asUser(user,()=>q(`select * from ${table}`))).length,0);
 assert.equal((await asUser(1,()=>q('select * from profiles'))).length,1);
 await asUser(1,()=>q("update profiles set role='super_admin'"));
 assert.equal((await q(`select role from profiles where id='${id(1)}'`))[0].role,'contractor_preview');
 await assert.rejects(asUser(1,()=>q(`insert into payments values('${id(1)}',999)`)),/row-level security/);
});
test('API guard blocks legacy RPCs, views, writes and unknown paths; only profile reads allowed',async()=>{
 for(const path of ['/rpc/refresh_tenancy_agreement_expiry','/rpc/client_owner_snapshot','/rpc/contractor_preview_attempt','/rpc/graphql','/payments','/profiles','/unknown']) {
 await assert.rejects(asUser(1,()=>db.exec(`set request.path='${path}';set request.method='POST';select marketplace_private.check_request()`)),/Contractor preview access only/);
 }
 for(const method of ['GET','HEAD']) await asUser(1,()=>db.exec(`set request.path='/profiles';set request.method='${method}';select marketplace_private.check_request()`));
 await assert.rejects(asUser(3,()=>db.exec("set request.path='/payments';set request.method='GET';select marketplace_private.check_request()")),/Client portal access only/);
});
test('existing staff and tenant RLS behavior remains unchanged; guard delegates existing Owner rule',async()=>{
 for(const user of [2,4]) {assert.equal((await asUser(user,()=>q('select * from payments'))).length,1);await asUser(user,()=>db.exec("set request.path='/payments';select marketplace_private.check_request()"));}
});
test('durable limiter is service-only, bounded, parallel-safe and resets after its window',async()=>{
 const key='contractor-preview:'+'a'.repeat(43);
 await assert.rejects(asUser(1,()=>q(`select contractor_preview_attempt('${key}')`)),/permission denied/);
 await db.exec('set role service_role');
 try {const results=await Promise.all(Array.from({length:12},()=>q(`select contractor_preview_attempt('${key}') allowed`)));
 assert.equal(results.filter(r=>r[0].allowed).length,5);}finally{await db.exec('reset role');}
 await db.exec(`update auth_login_rate_limits set window_started_at=now()-interval '16 minutes' where phone_hash='${key}'`);
 assert.equal((await q(`select contractor_preview_attempt('${key}') allowed`))[0].allowed,true);
 await assert.rejects(q("select contractor_preview_attempt('legacy-tenant-key')"),/Invalid attempt key/);
});
test('provisioning is service-only, requires a new banned identity, preserves existing people and audits once',async()=>{
 const phone='+60195556666';
 await assert.rejects(asUser(1,()=>q(`select finalize_contractor_preview('${id(5)}','${phone}')`)),/permission denied/);
 await assert.rejects(q(`select finalize_contractor_preview('${id(5)}','${phone}')`),/new banned/);
 await db.exec(`update auth.users set raw_app_meta_data='{"role":"contractor_preview","pilot_provisioning":true}',banned_until=now()+interval '1 day' where id='${id(5)}';update profiles set phone='0195556666' where id='${id(4)}'`);
 await assert.rejects(q(`select finalize_contractor_preview('${id(5)}','${phone}')`),/Phone already assigned/);
 assert.equal((await q(`select role from profiles where id='${id(5)}'`))[0].role,'tenant');
 await db.exec(`update profiles set phone=null where id='${id(4)}'`);
 await db.exec('set role service_role');try{await q(`select finalize_contractor_preview('${id(5)}','${phone}')`);}finally{await db.exec('reset role');}
 assert.equal((await q(`select role from profiles where id='${id(5)}'`))[0].role,'contractor_preview');
 assert.equal((await q('select * from audit_logs')).length,1);
 await assert.rejects(q(`select finalize_contractor_preview('${id(5)}','${phone}')`),/not a new tenant-default/);
 assert.equal((await q('select * from audit_logs')).length,1);
});
