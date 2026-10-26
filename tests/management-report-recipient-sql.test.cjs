// Synthetic local PostgreSQL only. No production credentials or provider calls.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const fixture=require('./fixtures/management-report.cjs');
const migrationPath='supabase/migrations/20261026023135_whapi_report_personal_recipient.sql';
const sql=fs.readFileSync(migrationPath,'utf8');
const oldRecipient='60168173911',recipient='60198894911';
let db,id,date,oldGrant,oldUnused,beforeRows,beforeSecurity,beforeBodies;
const rpc=async(name,args)=>(await db.rpcQuery(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const snapshot=()=>({company_id:id(1),report_date:date});
const authorize=(to=recipient)=>rpc('dekez_management_report_authorize_test',[id(1),date,to,snapshot(),'[TEST] Synthetic recipient change',id(3)]);
const consume=(grant,to=recipient)=>rpc('dekez_management_report_consume_test',[grant.authorization_id,id(1),to,id(3)]);
const captureRows=async()=>{
 const tables=['companies','profiles','properties','tenants','tenancies','tenant_records','payments','rent_bills','rental_invoice_line_items','payment_submissions','rooms','maintenance_tickets'];
 const rows=Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.query(`select * from public.${t} order by id`)).rows])));
 for(const t of ['test_authorizations','report_runs','delivery_attempts'])rows[t]=(await db.query(`select * from dekez_reports_private.${t} order by id`)).rows;
 return rows;
};
const security=async()=>({
 functions:(await db.query(`select n.nspname,p.proname,p.oid,p.proowner,p.proacl,p.proconfig,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dekez_reports_private' or (n.nspname='public' and p.proname like 'dekez_management_report_%') order by n.nspname,p.proname`)).rows,
 tables:(await db.query(`select c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c where c.relnamespace='dekez_reports_private'::regnamespace and c.relkind='r' order by c.relname`)).rows,
 policies:(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,
 memberships:(await db.query("select * from pg_auth_members where roleid='dekez_report_executor'::regrole order by roleid,member,grantor")).rows,
 executor:(await db.query("select rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,has_schema_privilege(rolname,'dekez_reports_private','CREATE') schema_create from pg_roles where rolname='dekez_report_executor'")).rows,
});

test.before(async()=>{
 db=await fixture({singleUseMigration:true});id=db.id;
 date=(await db.query("select to_char(clock_timestamp() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 // Exercise a real historical accepted report and a separate unused old grant.
 oldGrant=await authorize(oldRecipient);oldUnused=await authorize(oldRecipient);
 const oldClaim=await consume(oldGrant,oldRecipient);
 await rpc('dekez_management_report_finish',[oldClaim.attempt_id,'accepted','synthetic-old-provider-id',200,null]);
 beforeRows=await captureRows();beforeSecurity=await security();
 beforeBodies=(await db.query("select proname,prosrc from pg_proc where pronamespace='dekez_reports_private'::regnamespace order by proname")).rows;
 await db.exec('set role fixture_migrator');
 await db.exec(sql);
 await db.exec('reset role');
});
test.after(async()=>{await db?.close();});

test('forward migration preserves both applied migration files and touches no business tables or sends',()=>{
 for(const [file,hash] of [
  ['20261025083739_whapi_management_reports.sql','3dd63a191dc0a0901dde637c3b8e4a51beccfc5a2658a184d1466ea9356c0b75'],
  ['20261025145221_whapi_single_use_test_authorization.sql','63c2c41c4eaa214d631b2a27f5dde96a862fa04d32397ca130e10ba34830effc'],
 ])assert.equal(crypto.createHash('sha256').update(fs.readFileSync('supabase/migrations/'+file)).digest('hex'),hash);
 assert.match(sql,/set local lock_timeout = '5s'/);assert.match(sql,/set local statement_timeout = '30s'/);
 assert.doesNotMatch(sql,/\b(?:update|insert into|delete from|alter table|drop table)\s+public\.|\b(?:truncate|http_post|net\.http|cron\.schedule)\b/i);
 assert.equal((sql.match(/create or replace function/g)||[]).length,4);
});

test('recipient migration preserves every historical/source row and does not issue or reserve anything',async()=>{
 assert.deepEqual(await captureRows(),beforeRows);
 assert.deepEqual(db.migrationIdentity,{current_user:'fixture_migrator',rolsuper:false});
});

test('replacement retains function identities/owners/ACLs, table RLS, policies and restricted executor membership',async()=>{
 assert.deepEqual(await security(),beforeSecurity);
 const after=(await db.query("select proname,prosrc from pg_proc where pronamespace='dekez_reports_private'::regnamespace order by proname")).rows;
 for(const before of beforeBodies){
  const expected=before.proname==='claim'
   ?before.prosrc.replace('if p_kind is null or p_kind not in',"if p_recipient is distinct from '60198894911' or p_kind is null or p_kind not in")
   :['authorize_test','consume_test','revoke_test'].includes(before.proname)?before.prosrc.replaceAll(oldRecipient,recipient):before.prosrc;
  assert.equal(after.find(f=>f.proname===before.proname).prosrc,expected,before.proname+' changed beyond recipient guard');
 }
});

test('old and arbitrary recipients cannot issue new grants or use the ordinary daily/test claim path',async()=>{
 for(const to of [oldRecipient,'60123456789','+60198894911',null]){
  await assert.rejects(authorize(to),/Invalid test report authorization/);
  for(const kind of ['daily','test'])await assert.rejects(rpc('dekez_management_report_claim',[id(1),date,to,kind,snapshot(),'[TEST] rejected destination',id(3)]),/Invalid report/);
 }
 assert.deepEqual(await captureRows(),beforeRows);
});

test('historical old-number grants cannot be consumed or retargeted and remain byte-identical',async()=>{
 for(const grant of [oldGrant,oldUnused])for(const to of [oldRecipient,recipient]){
  assert.deepEqual(await consume(grant,to),{claimed:false,state:'not_authorized'});
  assert.deepEqual(await rpc('dekez_management_report_revoke_test',[grant.authorization_id,id(1),to,id(3)]),{revoked:false,state:'not_authorized'});
 }
 assert.deepEqual(await captureRows(),beforeRows);
});

test('new-recipient test can be approved/cancelled/consumed once without rewriting the old destination history',async()=>{
 const cancelled=await authorize();
 assert.equal((await rpc('dekez_management_report_revoke_test',[cancelled.authorization_id,id(1),recipient,id(3)])).revoked,true);
 assert.deepEqual(await consume(cancelled),{claimed:false,state:'not_authorized'});
 const grant=await authorize();assert.equal(grant.recipient,recipient);
 const claim=await consume(grant);assert.equal(claim.claimed,true);assert.equal(claim.recipient,recipient);
 assert.deepEqual(await consume(grant),{claimed:false,state:'consumed'});
 await rpc('dekez_management_report_finish',[claim.attempt_id,'uncertain',null,500,'delivery_uncertain']);
 assert.deepEqual(await authorize(),{state:'duplicate'});
 const after=await captureRows();
 for(const [table,rows] of Object.entries(beforeRows)){
  if(['test_authorizations','report_runs','delivery_attempts'].includes(table))assert.deepEqual(after[table].filter(row=>rows.some(before=>before.id===row.id)),rows);
  else assert.deepEqual(after[table],rows);
 }
 assert.equal(after.report_runs.length,2);assert.equal(after.delivery_attempts.length,2);
});

test('ordinary configured new-recipient report retains company/date validation and duplicate protection',async()=>{
 const args=[id(1),date,recipient,'daily',snapshot(),'Synthetic ordinary report',null];
 const first=await rpc('dekez_management_report_claim',args);assert.equal(first.claimed,true);
 assert.equal((await rpc('dekez_management_report_claim',args)).claimed,false);
 await assert.rejects(rpc('dekez_management_report_claim',[id(2),date,recipient,'daily',snapshot(),'Invalid scope',null]),/Invalid report/);
});

test('historical storage allowance never grants direct reporting access to browser or service roles',async()=>{
 for(const role of ['anon','authenticated','service_role'])for(const table of ['test_authorizations','report_runs','delivery_attempts']){
  await db.exec(`begin; set local role ${role}`);
  try{await assert.rejects(db.query(`select * from dekez_reports_private.${table}`),/permission denied/);}
  finally{await db.exec('rollback');}
 }
});
