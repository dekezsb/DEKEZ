// Real PostgreSQL engine (PGlite), synthetic fixture only: no remote DB/network.
// PGlite has one connection, so competing calls are serialized by the fixture;
// these tests verify atomic RPC outcomes/constraints, not native multi-session locks.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const migrationPath='supabase/migrations/20261025145221_whapi_single_use_test_authorization.sql';
const sql=fs.readFileSync(migrationPath,'utf8');
let db,id,date;
const recipient='60168173911';
const rpc=async(name,args)=>(await db.rpcQuery(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const snapshot=()=>({company_id:id(1),report_date:date,collected_today:125,as_of:new Date().toISOString()});
const authorize=(overrides={})=>{const a={company:id(1),date,recipient,snapshot:snapshot(),body:'[TEST] DEKEZ synthetic report',actor:id(3),...overrides};
 return rpc('dekez_management_report_authorize_test',[a.company,a.date,a.recipient,a.snapshot,a.body,a.actor]);};
const consume=(grant,overrides={})=>{const a={authorization:grant.authorization_id,company:id(1),recipient,actor:id(3),...overrides};
 return rpc('dekez_management_report_consume_test',[a.authorization,a.company,a.recipient,a.actor]);};
const revoke=(grant,overrides={})=>{const a={authorization:grant.authorization_id,company:id(1),recipient,actor:id(3),...overrides};
 return rpc('dekez_management_report_revoke_test',[a.authorization,a.company,a.recipient,a.actor]);};
const counts=async()=>(await db.query(`select
 (select count(*)::int from dekez_reports_private.test_authorizations) authorizations,
 (select count(*)::int from dekez_reports_private.report_runs) runs,
 (select count(*)::int from dekez_reports_private.delivery_attempts) attempts`)).rows[0];
test.before(async()=>{db=await require('./fixtures/management-report.cjs')({singleUseMigration:true});id=db.id;
 await db.query('insert into profiles values ($1,$2,$3)',[id(5),'super_admin','approved']);
});
test.beforeEach(async()=>{
 await db.exec('truncate dekez_reports_private.test_authorizations,dekez_reports_private.delivery_attempts,dekez_reports_private.report_runs');
 await db.query("update profiles set role='super_admin',registration_status='approved' where id=$1",[id(3)]);
 date=(await db.query("select to_char(clock_timestamp() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
});
test.after(async()=>{await db?.close();});

test('additive migration runs with the production-like non-superuser migration identity',()=>{
 assert.deepEqual(db.migrationIdentity,{current_user:'fixture_migrator',rolsuper:false});
 assert.match(sql,/^begin;/m);assert.match(sql,/set local lock_timeout = '5s'/);
 assert.doesNotMatch(sql,/\b(create or replace|drop |alter table public\.|update public\.|insert into public\.|delete from public\.|whatsapp_)/i);
});

test('authorization table is forced-RLS, and browser/service roles have no direct table privileges',async()=>{
 const table=(await db.query("select c.relrowsecurity,c.relforcerowsecurity,r.rolname owner from pg_class c join pg_roles r on r.oid=c.relowner where c.oid='dekez_reports_private.test_authorizations'::regclass")).rows[0];
 assert.equal(table.relrowsecurity,true);assert.equal(table.relforcerowsecurity,true);assert.equal(table.owner,'fixture_migrator');
 for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
  assert.equal((await db.query("select has_table_privilege($1,'dekez_reports_private.test_authorizations',$2) allowed",[role,privilege])).rows[0].allowed,false,`${role} ${privilege}`);
 }
 for(const privilege of ['SELECT','INSERT','UPDATE'])assert.equal((await db.query("select has_table_privilege('dekez_report_executor','dekez_reports_private.test_authorizations',$1) allowed",[privilege])).rows[0].allowed,true);
 for(const privilege of ['DELETE','TRUNCATE'])assert.equal((await db.query("select has_table_privilege('dekez_report_executor','dekez_reports_private.test_authorizations',$1) allowed",[privilege])).rows[0].allowed,false);
 const policies=(await db.query("select roles,cmd from pg_policies where schemaname='dekez_reports_private' and tablename='test_authorizations' order by cmd")).rows;
 assert.deepEqual(policies.map(p=>p.cmd),['INSERT','SELECT','UPDATE']);assert.ok(policies.every(p=>p.roles.length===1&&p.roles[0]==='dekez_report_executor'));
});

test('all new functions have narrow EXECUTE grants, empty search paths, and restricted ownership',async()=>{
 const functions=(await db.query(`select p.oid::regprocedure::text signature,p.prosecdef,p.proconfig,r.rolname owner,n.nspname
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
 where (n.nspname='dekez_reports_private' and p.proname in('authorize_test','consume_test','revoke_test'))
 or (n.nspname='public' and p.proname in('dekez_management_report_authorize_test','dekez_management_report_consume_test','dekez_management_report_revoke_test'))`)).rows;
 assert.equal(functions.length,6);
 for(const f of functions){
  assert.ok(f.proconfig.some(c=>c==='search_path=""'));assert.ok(f.proconfig.some(c=>c==='statement_timeout=10s'));
  assert.equal(f.prosecdef,f.nspname==='dekez_reports_private');
  if(f.prosecdef){assert.equal(f.owner,'dekez_report_executor');assert.ok(f.proconfig.includes('row_security=on'));}
  for(const role of ['anon','authenticated'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,f.signature])).rows[0].allowed,false);
  assert.equal((await db.query('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') allowed',[f.signature])).rows[0].allowed,true);
 }
 const role=(await db.query("select rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname='dekez_report_executor'")).rows[0];
 assert.ok(Object.values(role).every(v=>v===false));
 assert.equal((await db.query("select has_schema_privilege('dekez_report_executor','dekez_reports_private','CREATE') allowed")).rows[0].allowed,false);
 assert.equal((await db.query("select has_table_privilege('dekez_report_executor','public.payments','SELECT') allowed")).rows[0].allowed,false);
 const memberships=(await db.query("select r.rolname,m.inherit_option,m.set_option from pg_auth_members m join pg_roles r on r.oid=m.member where m.roleid=(select oid from pg_roles where rolname='dekez_report_executor')")).rows;
 assert.ok(memberships.every(m=>!m.inherit_option&&!m.set_option));
});

test('ordinary portal roles and forged JWT metadata cannot call wrappers or internal functions',async()=>{
 for(const role of ['anon','authenticated'])for(const call of [
  "select public.dekez_management_report_authorize_test(null,null,null,null,null,null)",
  "select public.dekez_management_report_consume_test(null,null,null,null)",
  "select public.dekez_management_report_revoke_test(null,null,null,null)",
  "select dekez_reports_private.authorize_test(null,null,null,null,null,null)",
  "select dekez_reports_private.consume_test(null,null,null,null)",
  "select dekez_reports_private.revoke_test(null,null,null,null)",
  "select * from dekez_reports_private.test_authorizations"
 ]){
  await db.exec(`begin;set local role ${role};set local request.jwt.claims='{"role":"service_role","user_metadata":{"role":"super_admin"}}';`);
  try{await assert.rejects(db.query(call),/permission denied|Reporting server role required/);}finally{await db.exec('rollback');}
 }
 assert.deepEqual(await counts(),{authorizations:0,runs:0,attempts:0});
});

test('an accidental internal EXECUTE grant still cannot elevate a browser role with forged server claims',async()=>{
 await db.exec('grant usage on schema dekez_reports_private to authenticated;grant execute on function dekez_reports_private.consume_test(uuid,uuid,text,uuid) to authenticated;');
 try{
  await db.exec(`begin;set local role authenticated;set local request.jwt.claims='{"role":"service_role","app_metadata":{"role":"super_admin"}}';`);
  try{await assert.rejects(db.query('select dekez_reports_private.consume_test(null,null,null,null)'),/Reporting server role required/);}
  finally{await db.exec('rollback');}
 }finally{await db.exec('revoke usage on schema dekez_reports_private from authenticated;revoke execute on function dekez_reports_private.consume_test(uuid,uuid,text,uuid) from authenticated;');}
 assert.equal((await counts()).attempts,0);
});

test('caller search_path and shadow temporary objects cannot redirect privileged report writes',async()=>{
 const grant=await authorize();
 await db.exec('create temp table test_authorizations(id uuid);create temp table report_runs(id uuid);create temp table delivery_attempts(id uuid);set search_path=pg_temp,public;');
 try{
  assert.equal((await consume(grant)).claimed,true);
  assert.equal((await db.query('select count(*)::int n from pg_temp.report_runs')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from pg_temp.delivery_attempts')).rows[0].n,0);
 }finally{await db.exec('set search_path=public;drop table pg_temp.test_authorizations,pg_temp.report_runs,pg_temp.delivery_attempts');}
});

test('issuance binds exact actor/company/date/recipient/snapshot/body and expires within five minutes without sending',async()=>{
 const before=Date.now(),grant=await authorize(),after=Date.now();
 assert.equal(grant.company_id,id(1));assert.equal(grant.report_date,date);assert.equal(grant.recipient,recipient);assert.equal(grant.body,'[TEST] DEKEZ synthetic report');
 assert.match(grant.authorization_id,/^[a-f0-9-]{36}$/);assert.ok(Date.parse(grant.expires_at)>before);assert.ok(Date.parse(grant.expires_at)<=after+300000);
 const stored=(await db.query('select * from dekez_reports_private.test_authorizations where id=$1',[grant.authorization_id])).rows[0];
 assert.equal(stored.requested_by,id(3));assert.deepEqual(stored.snapshot.company_id,id(1));assert.equal(stored.consumed_at,null);
 assert.deepEqual(await counts(),{authorizations:1,runs:0,attempts:0});
});

test('issuance rejects arbitrary recipients, forged scope/date, non-test bodies, and missing company',async()=>{
 for(const change of [{recipient:'60123456789'},{recipient:'+60168173911'},{recipient:null},{date:'2000-01-01'},
  {snapshot:{company_id:id(2),report_date:date}},{snapshot:{company_id:id(1),report_date:'2000-01-01'}},
  {snapshot:{}},{snapshot:null},{body:'A non-test report'},{body:'[TEST]'+''.padEnd(4000,'x')},{actor:null},{company:null}]){
  await assert.rejects(authorize(change),/Invalid test report authorization|Administrator required/);
 }
 await assert.rejects(authorize({company:id(999),snapshot:{company_id:id(999),report_date:date}}),/foreign key/);
 assert.deepEqual(await counts(),{authorizations:0,runs:0,attempts:0});
});

test('fresh approved Admin status required at issuance and execution, not cached role metadata',async()=>{
 for(const role of ['tenant','client_owner','owner','contractor_preview','management','admin','super_admin']){
  await db.query('update profiles set role=$1,registration_status=$2 where id=$3',[role,role==='super_admin'?'rejected':'approved',id(3)]);
  await assert.rejects(authorize(),/Administrator required/);
 }
 await db.query("update profiles set role='super_admin',registration_status='approved' where id=$1",[id(3)]);
 const grant=await authorize();await db.query("update profiles set registration_status='rejected' where id=$1",[id(3)]);
 await assert.rejects(consume(grant),/Administrator required/);await assert.rejects(revoke(grant),/Administrator required/);
 assert.equal((await counts()).attempts,0);
});

test('wrong actor/company/recipient and guessed authorization IDs cannot consume or revoke grants',async()=>{
 const grant=await authorize();
 for(const override of [{actor:id(5)},{company:id(2)},{recipient:'60123456789'},{recipient:null},{company:null},{authorization:id(999)}]){
  assert.deepEqual(await consume(grant,override),{claimed:false,state:'not_authorized'});
  assert.deepEqual(await revoke(grant,override),{revoked:false,state:'not_authorized'});
 }
 assert.equal((await consume(grant)).claimed,true);
});

test('expired and prior-Malaysia-date grants cannot create a run or attempt',async()=>{
 for(const expiryMode of ['elapsed','date_boundary']){
  const grant=await authorize();
  if(expiryMode==='elapsed')await db.query("update dekez_reports_private.test_authorizations set created_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' where id=$1",[grant.authorization_id]);
  else await db.query("update dekez_reports_private.test_authorizations set report_date=report_date-1,snapshot=jsonb_set(snapshot,'{report_date}',to_jsonb((report_date-1)::text)) where id=$1",[grant.authorization_id]);
  assert.deepEqual(await consume(grant),{claimed:false,state:'expired'});
 }
 assert.equal((await counts()).runs,0);assert.equal((await counts()).attempts,0);
 const rowLock=sql.indexOf('where id=p_authorization for update;');
 assert.ok(rowLock>=0&&sql.indexOf('checked:=clock_timestamp();',rowLock)>rowLock);
 assert.match(sql,/least\(issued\+interval '5 minutes',\(p_date\+1\)::timestamp at time zone 'Asia\/Kuala_Lumpur'\)/);
});

test('cancel revokes only an unconsumed matching grant, cannot undo a claimed attempt',async()=>{
 const first=await authorize();assert.deepEqual(await revoke(first),{revoked:true,state:'revoked'});
 assert.deepEqual(await revoke(first),{revoked:true,state:'revoked'});assert.deepEqual(await consume(first),{claimed:false,state:'not_authorized'});
 const second=await authorize();assert.equal((await consume(second)).claimed,true);
 assert.deepEqual(await revoke(second),{revoked:false,state:'consumed'});
 assert.equal((await counts()).attempts,1);
});

test('simultaneous calls for one grant produce exactly one atomic consumption and delivery reservation',async()=>{
 const grant=await authorize(),results=await Promise.all(Array.from({length:20},()=>consume(grant)));
 assert.equal(results.filter(r=>r.claimed).length,1);assert.equal(results.filter(r=>r.state==='consumed').length,19);
 const claim=results.find(r=>r.claimed);assert.equal(claim.body,grant.body);assert.equal(claim.recipient,recipient);assert.equal(claim.company_id,id(1));assert.equal(claim.report_date,date);
 const stored=(await db.query('select consumed_at,run_id,attempt_id from dekez_reports_private.test_authorizations where id=$1',[grant.authorization_id])).rows[0];
 assert.ok(stored.consumed_at);assert.equal(stored.run_id,claim.run_id);assert.equal(stored.attempt_id,claim.attempt_id);
 assert.deepEqual(await counts(),{authorizations:1,runs:1,attempts:1});
});

test('different grants for the same report date cannot multiply test delivery attempts',async()=>{
 const grants=await Promise.all(Array.from({length:12},()=>authorize()));
 const results=await Promise.all(grants.map(grant=>consume(grant)));
 assert.equal(results.filter(r=>r.claimed).length,1);assert.equal(results.filter(r=>r.state==='duplicate').length,11);
 assert.deepEqual(await counts(),{authorizations:12,runs:1,attempts:1});
 assert.equal((await db.query('select count(*)::int n from dekez_reports_private.test_authorizations where consumed_at is not null')).rows[0].n,12);
});

test('every existing run state blocks new authorization and previously-issued grants, including rejected/uncertain',async()=>{
 for(const state of ['sending','accepted','rejected','uncertain']){
  await db.exec('truncate dekez_reports_private.test_authorizations,dekez_reports_private.delivery_attempts,dekez_reports_private.report_runs');
  const grant=await authorize();
  await db.query("insert into dekez_reports_private.report_runs(company_id,report_date,recipient,kind,state,snapshot,message_body,requested_by) values($1,$2,$3,'test',$4,$5,'[TEST] previous',$6)",[id(1),date,recipient,state,snapshot(),id(3)]);
  assert.deepEqual(await authorize(),{state:'duplicate'});assert.deepEqual(await consume(grant),{claimed:false,state:'duplicate'});
  assert.deepEqual(await consume(grant),{claimed:false,state:'consumed'});assert.equal((await counts()).attempts,0);
 }
});

test('failed attempt insertion rolls back grant consumption and run reservation together',async()=>{
 const grant=await authorize();
 await db.exec("create function public.fixture_fail_attempt() returns trigger language plpgsql as $$ begin raise exception 'Synthetic attempt failure';end $$;create trigger fixture_fail_attempt before insert on dekez_reports_private.delivery_attempts for each row execute function public.fixture_fail_attempt();");
 try{await assert.rejects(consume(grant),/Synthetic attempt failure/);
  assert.equal((await counts()).runs,0);assert.equal((await counts()).attempts,0);
  assert.equal((await db.query('select consumed_at from dekez_reports_private.test_authorizations where id=$1',[grant.authorization_id])).rows[0].consumed_at,null);
 }finally{await db.exec('drop trigger fixture_fail_attempt on dekez_reports_private.delivery_attempts;drop function public.fixture_fail_attempt()');}
 assert.equal((await consume(grant)).claimed,true);
});

test('existing finish function preserves accepted/rejected/uncertain logs and one-time flow never retries them',async()=>{
 for(const state of ['accepted','rejected','uncertain']){
  await db.exec('truncate dekez_reports_private.test_authorizations,dekez_reports_private.delivery_attempts,dekez_reports_private.report_runs');
  const grant=await authorize(),claim=await consume(grant);
  await rpc('dekez_management_report_finish',[claim.attempt_id,state,state==='accepted'?'fixture-provider-id':null,state==='rejected'?401:200,state==='accepted'?null:state==='rejected'?'provider_rejected':'delivery_uncertain']);
  assert.deepEqual(await consume(grant),{claimed:false,state:'consumed'});assert.deepEqual(await authorize(),{state:'duplicate'});
  const attempt=(await db.query('select state,attempt_number,provider_message_id from dekez_reports_private.delivery_attempts')).rows[0];
  assert.equal(attempt.state,state);assert.equal(attempt.attempt_number,1);assert.equal(attempt.provider_message_id,state==='accepted'?'fixture-provider-id':null);
 }
});

test('grant/consume/revoke leave rental, tenant, payment, room and maintenance source rows unchanged',async()=>{
 const sources=['companies','profiles','properties','tenants','tenancies','tenant_records','payments','rent_bills','rental_invoice_line_items','payment_submissions','rooms','maintenance_tickets'];
 const capture=async()=>Object.fromEntries(await Promise.all(sources.map(async table=>[table,(await db.query(`select * from public.${table} order by id`)).rows])));
 const before=await capture(),snapshotBefore=await rpc('dekez_management_report_snapshot',[id(1),'2026-10-25T12:00:00Z']);
 const first=await authorize();await revoke(first);const second=await authorize();await consume(second);
 assert.deepEqual(await capture(),before);
 assert.deepEqual(await rpc('dekez_management_report_snapshot',[id(1),'2026-10-25T12:00:00Z']),snapshotBefore);
});
