const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const fixture=require('./fixtures/rental-collection.cjs');
const migration='supabase/migrations/20261028122044_rental_collection_callback_setup.sql';
const sql=fs.readFileSync(migration,'utf8'),company='660cc0c4-daee-445b-9146-ccd112e791d4';
let db,id;
const rpc=async(name,args)=>(await db.rpcQuery(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const check=(actor=id(3),scope=company,operation=id(200))=>rpc('dekez_collection_setup_check',[scope,actor,operation]);
const claim=(changes={})=>{const a={scope:company,actor:id(3),operation:id(200),before:'a'.repeat(64),after:'b'.repeat(64),deployment:'dpl_SYNTHETICONLY',...changes};return rpc('dekez_collection_setup_claim',Object.values(a));};
const finish=(outcome='verified',actor=id(3))=>rpc('dekez_collection_setup_finish',[company,actor,id(200),outcome]);
const provision=()=>db.query(`insert into dekez_collections_private.callback_setup(id,company_id,channel,operation_key,approved_actor,created_at,expires_at)
 select $1,$2,'FALCON-D9NS9','rental_callback_v1',$3,t,t+interval '10 minutes' from (select clock_timestamp() t) x`,[id(200),company,id(3)]);
test.before(async()=>{
 db=await fixture();id=db.id;
 await db.query('insert into public.companies values($1)',[company]);
 await db.query(`insert into public.company_users values($1,$2,$3,$3,'super_admin','active')`,[id(199),company,id(3)]);
 await db.exec('set role fixture_migrator');await db.exec(sql);await db.exec('reset role');
});
test.after(async()=>{await db?.close();});
test.beforeEach(async()=>{
 await db.exec(`truncate dekez_collections_private.callback_setup,user_module_permissions;
 update profiles set role='super_admin',registration_status='approved' where id='${id(3)}';
 update company_users set status='active',role='super_admin' where id='${id(199)}';`);
});
test('migration is additive, empty and has bounded locks; no issue/reset API or existing data changes',async()=>{
 assert.match(sql,/lock_timeout = '5s'/);assert.match(sql,/unique\(company_id,operation_key\)/);
 assert.doesNotMatch(sql,/\b(?:insert into|update|delete from|alter table|drop table)\s+public\./i);
 assert.doesNotMatch(sql,/\binsert into\b|\bdelete from\b|\btruncate\b.*;/i);
 assert.doesNotMatch(sql,/cron\.schedule|http_post|ttlock|send_enabled|create or replace/i);
 assert.equal((await db.query('select count(*) n from dekez_collections_private.callback_setup')).rows[0].n,0);
});
test('missing authorization fails closed; operator-approved row exposes only safe status',async()=>{
 assert.equal((await check()).state,'missing');await provision();const state=await check();
 assert.equal(state.state,'ready');assert.deepEqual(Object.keys(state).sort(),['after_hash','before_hash','consumed','deployment','expires_at','outcome','state']);
 assert.equal(state.consumed,false);assert.equal(state.after_hash,null);
 assert.equal(state.outcome,null);
});
test('authorized claim is once only and binds actor, hashes and deployment',async()=>{
 await provision();assert.equal((await claim()).state,'claimed');assert.equal((await claim()).state,'used');
 assert.equal((await check()).state,'consumed');const row=(await db.query('select * from dekez_collections_private.callback_setup')).rows[0];
 assert.equal(row.approved_actor,id(3));assert.equal(row.before_hash,'a'.repeat(64));assert.equal(row.after_hash,'b'.repeat(64));
 assert.equal(row.deployment,'dpl_SYNTHETICONLY');assert(row.consumed_at);
 assert.equal((await claim({before:'c'.repeat(64)})).state,'used');
});
test('all expired, future and revoked grants are unavailable without consumption',async()=>{
 for(const mode of ['expired','future','revoked']){
  await db.exec('truncate dekez_collections_private.callback_setup');await provision();
  if(mode==='expired')await db.exec("update dekez_collections_private.callback_setup set created_at=clock_timestamp()-interval '20 minutes',expires_at=clock_timestamp()-interval '10 minutes'");
  if(mode==='future')await db.exec("update dekez_collections_private.callback_setup set created_at=clock_timestamp()+interval '1 minute',expires_at=clock_timestamp()+interval '10 minutes'");
  if(mode==='revoked')await db.exec('update dekez_collections_private.callback_setup set revoked_at=clock_timestamp()');
  assert.equal((await check()).state,mode==='revoked'?'revoked':'expired');
  assert.equal((await claim()).state,mode==='revoked'?'revoked':'expired');
  assert.equal((await db.query('select consumed_at from dekez_collections_private.callback_setup')).rows[0].consumed_at,null);
 }
});
test('fixed company, channel and operation constraints cannot be widened',async()=>{
 await provision();
 for(const patch of ["channel='OTHER'","operation_key='rental_callback_v2'",`company_id='${id(1)}'`,"expires_at=created_at+interval '16 minutes'","created_at='-infinity'","expires_at='infinity'"])
  await assert.rejects(db.exec('update dekez_collections_private.callback_setup set '+patch),/check constraint/);
 await assert.rejects(db.query(`insert into dekez_collections_private.callback_setup select $1,company_id,channel,operation_key,approved_actor,created_at,expires_at,null,null,null,null,null,null,null from dekez_collections_private.callback_setup`,[id(201)]),/unique/);
});
test('wrong actor, scope and operation cannot consume',async()=>{
 await provision();
 await assert.rejects(claim({scope:id(1)}),/Approved callback setup scope/);
 await assert.rejects(claim({actor:id(4)}),/administrator|Admin/);
 assert.equal((await claim({operation:id(999)})).state,'missing');
 await db.query(`insert into profiles values($1,'Synthetic different admin','60111111112','super_admin','approved')`,[id(202)]);
 await db.query(`insert into company_users values($1,$2,$3,$3,'super_admin','active')`,[id(203),company,id(202)]);
 assert.equal((await claim({actor:id(202)})).state,'not_authorized');
});
test('fresh profile, company membership and explicit admin_setup restriction are mandatory',async()=>{
 await provision();
 for(const patch of ["role='admin'","registration_status='pending'"]){
  await db.exec(`update profiles set ${patch} where id='${id(3)}'`);await assert.rejects(claim(),/Admin|administrator/);
  await db.exec(`update profiles set role='super_admin',registration_status='approved' where id='${id(3)}'`);
 }
 await db.exec(`update company_users set status='inactive' where id='${id(199)}'`);await assert.rejects(check(),/administrator/);
 await db.exec(`update company_users set status='active' where id='${id(199)}';insert into user_module_permissions values('${id(3)}','admin_setup','none')`);
 await assert.rejects(claim(),/Super Admin/);assert.equal((await db.query('select consumed_at from dekez_collections_private.callback_setup')).rows[0].consumed_at,null);
});
test('hashes/deployment are bounded and equal hashes support consumed no-op verification',async()=>{
 await provision();
 for(const patch of [{before:null},{before:'A'.repeat(64)},{after:'short'},{deployment:'https://unsafe.test'},{deployment:'dpl_x'},{deployment:null}])await assert.rejects(claim(patch),/Invalid/);
 assert.equal((await check()).state,'ready');
 assert.equal((await claim({after:'a'.repeat(64)})).state,'claimed');
 assert.equal((await claim()).state,'used');
});
test('outcomes append once, are immutable, and cannot reopen consumed reservations',async()=>{
 await provision();assert.equal((await finish()).state,'not_consumed');await claim();
 assert.equal((await finish('uncertain')).state,'recorded');assert.equal((await finish('uncertain')).state,'already_finished');
 await assert.rejects(finish('verified'),/immutable/);await assert.rejects(finish('retry'),/Invalid/);
 await db.exec("update dekez_collections_private.callback_setup set revoked_at=clock_timestamp()");
 const state=await check();assert.equal(state.state,'revoked');assert.equal(state.consumed,true);assert.equal(state.after_hash,'b'.repeat(64));assert.equal(state.deployment,'dpl_SYNTHETICONLY');
 assert.equal((await claim()).state,'used');
});
test('finishing after expiry records outcome but never renews authorization',async()=>{
 await provision();await claim();
 // Move all fixture timestamps consistently; no production clock or expiry is changed.
 await db.exec("update dekez_collections_private.callback_setup set created_at=created_at-interval '20 minutes',expires_at=expires_at-interval '20 minutes',consumed_at=consumed_at-interval '20 minutes'");
 assert.equal((await check()).state,'expired');
 assert.equal((await finish('preflight_failed')).state,'recorded');assert.equal((await claim()).state,'used');
});
test('migration refuses a privileged or login-capable replacement executor',()=>{
 assert.match(sql,/not rolcanlogin[\s\S]*not rolinherit[\s\S]*not rolsuper[\s\S]*not rolcreatedb[\s\S]*not rolcreaterole[\s\S]*not rolreplication[\s\S]*not rolbypassrls/);
 assert(sql.indexOf('Expected unprivileged collection executor')<sql.indexOf('grant dekez_collection_executor'));
});
test('private table is forced RLS; browser/runtime cannot directly access or issue authorizations',async()=>{
 const r=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='dekez_collections_private.callback_setup'::regclass")).rows[0];
 assert.deepEqual(r,{relrowsecurity:true,relforcerowsecurity:true});
 for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])
  assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',[role,'dekez_collections_private.callback_setup',privilege])).rows[0].ok,false);
 for(const privilege of ['INSERT','DELETE','TRUNCATE'])assert.equal((await db.query('select has_table_privilege($1,$2,$3) ok',['dekez_collection_executor','dekez_collections_private.callback_setup',privilege])).rows[0].ok,false);
 for(const column of ['id','company_id','channel','operation_key','approved_actor','created_at','expires_at','revoked_at'])
  assert.equal((await db.query("select has_column_privilege('dekez_collection_executor','dekez_collections_private.callback_setup',$1,'UPDATE') ok",[column])).rows[0].ok,false);
});
test('seven new functions have safe paths and no browser grants; executor remains unprivileged',async()=>{
 const f=(await db.query("select p.oid,p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('setup_check','setup_claim','setup_finish','dekez_collection_setup_assert_admin','dekez_collection_setup_check','dekez_collection_setup_claim','dekez_collection_setup_finish')")).rows;
 assert.equal(f.length,7);for(const fn of f){assert(fn.proconfig.includes('search_path=""'));assert.equal(fn.prosecdef,fn.nspname==='dekez_collections_private',JSON.stringify(fn));if(fn.prosecdef){assert.equal(fn.owner,'dekez_collection_executor');assert(fn.proconfig.includes('row_security=on'));}for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,$2::oid,'EXECUTE') ok",[role,fn.oid])).rows[0].ok,false,role+' '+JSON.stringify(fn));}
 const r=(await db.query("select rolcanlogin,rolsuper,rolbypassrls from pg_roles where rolname='dekez_collection_executor'")).rows[0];assert.deepEqual(r,{rolcanlogin:false,rolsuper:false,rolbypassrls:false});
 assert.equal((await db.query("select has_schema_privilege('dekez_collection_executor','dekez_collections_private','CREATE') ok")).rows[0].ok,false);
});
test('actual retirement script revokes a future-dated permit and setup grants without deleting history',async()=>{
 await provision();
 await db.exec("update dekez_collections_private.callback_setup set created_at=created_at+interval '5 minutes',expires_at=expires_at+interval '5 minutes'");
 assert.equal((await check()).state,'expired');
 const memberships=async()=>(await db.query("select coalesce(jsonb_agg(to_jsonb(m) order by m.grantor),'[]'::jsonb) rows from pg_auth_members m where m.roleid='dekez_collection_executor'::regrole and m.member='fixture_migrator'::regrole")).rows[0].rows;
 const originalMemberships=await memberships();
 await db.exec('set role fixture_migrator');
 try {await db.exec(fs.readFileSync('scripts/retire-rental-callback-setup.sql','utf8'));}
 finally {await db.exec('reset role');}
 assert.deepEqual(await memberships(),originalMemberships,'Temporary SET privilege must be restored exactly');
 const row=(await db.query('select id,revoked_at<created_at revoked_before_start,consumed_at from dekez_collections_private.callback_setup')).rows[0];
 assert.deepEqual(row,{id:id(200),revoked_before_start:true,consumed_at:null});
 for(const signature of ['public.dekez_collection_setup_assert_admin(uuid,uuid)','public.dekez_collection_setup_check(uuid,uuid,uuid)',
  'public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text)','public.dekez_collection_setup_finish(uuid,uuid,uuid,text)',
  'dekez_collections_private.setup_check(uuid,uuid,uuid)','dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text)',
  'dekez_collections_private.setup_finish(uuid,uuid,uuid,text)'])
  assert.equal((await db.query("select has_function_privilege('service_role',$1,'EXECUTE') ok",[signature])).rows[0].ok,false);
 await assert.rejects(check(),/permission denied/);
 assert.equal((await db.query("select has_function_privilege('service_role','public.dekez_collection_assert_admin(uuid,uuid)','EXECUTE') ok")).rows[0].ok,true);
});
