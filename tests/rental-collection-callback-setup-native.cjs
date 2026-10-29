// Synthetic localhost only. Never accepts an external database URL, production
// credential, .env, provider token or live tenant record. Independent sessions.
// node tests/rental-collection-callback-setup-native.cjs --pg-bin <bin> --output-dir <artifacts>
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const net=require('node:net'),assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process');
const option=name=>{const i=process.argv.indexOf(name);return i<0?null:process.argv[i+1];};
const pg=option('--pg-bin'),output=option('--output-dir');
if(!pg||!output)throw Error('Explicit localhost binary and artifact paths required');
const repo=path.resolve(__dirname,'..'),root=path.resolve(output);fs.mkdirSync(root,{recursive:true});
const work=fs.mkdtempSync(path.join(root,'isolated-')),data=path.join(work,'cluster');
const password=crypto.randomBytes(32).toString('hex'),passfile=path.join(work,'ephemeral-init-password');
const evidence={startedAt:new Date().toISOString(),scope:'Synthetic localhost only; unmodified migrations; independent PostgreSQL sessions.',providerCalls:0,migrations:[],tests:[],waits:[]};
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`,q=x=>"'"+String(x).replaceAll("'","''")+"'";
const company='660cc0c4-daee-445b-9146-ccd112e791d4',actor=id(3),operation=id(200);
const binary=name=>path.join(path.resolve(pg),name+(process.platform==='win32'?'.exe':''));
let port,started=false,observer,a,b,holder;const clients=new Set();
const args=()=>['-h','127.0.0.1','-p',String(port),'-U','local_review','-d','postgres','-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
function env(){const e={...process.env};for(const k of Object.keys(e))if(k.startsWith('PG'))delete e[k];return{...e,PGPASSWORD:password,PGCONNECT_TIMEOUT:'5',PGHOST:'127.0.0.1',PGPORT:String(port),PGDATABASE:'postgres',PGUSER:'local_review'};}
function run(name,argv,options={}){const r=spawnSync(binary(name),argv,{encoding:'utf8',windowsHide:true,timeout:60000,...options});if(r.status!==0)throw Error(name+' failed: '+(r.stderr||r.stdout||r.error));return r.stdout;}
class Session{
 constructor(name){this.name=name;this.out='';this.err='';this.pending=null;this.child=spawn(binary('psql'),args(),{env:env(),windowsHide:true,stdio:['pipe','pipe','pipe']});clients.add(this);
  this.child.stdout.on('data',x=>{this.out+=x.toString();this.flush();});this.child.stderr.on('data',x=>{this.err+=x.toString();});
  this.child.on('close',()=>{clients.delete(this);if(this.pending){this.pending.reject(Error(this.err||'Session closed'));this.pending=null;}});
  this.child.on('error',e=>{if(this.pending){this.pending.reject(e);this.pending=null;}});}
 flush(){const p=this.pending;if(!p)return;const at=this.out.indexOf(p.marker);if(at<0)return;const r=this.out.slice(0,at).trim();this.out=this.out.slice(at+p.marker.length).replace(/^\r?\n/,'');this.pending=null;p.resolve(r);}
 query(sql){assert.equal(this.pending,null);const marker='END_'+crypto.randomBytes(10).toString('hex');return new Promise((resolve,reject)=>{this.pending={marker,resolve,reject};this.child.stdin.write(sql+`;\nselect '${marker}';\n`);this.flush();});}
 async json(sql){return JSON.parse(await this.query(sql));}close(){if(!this.child.killed)this.child.stdin.end('\\q\n');}
}
async function session(name,role='service_role'){const s=new Session(name);if(role)await s.query('set role '+role);s.pid=Number(await s.query('select pg_backend_pid()'));return s;}
async function test(name,fn){const t=Date.now();try{const details=await fn();evidence.tests.push({name,status:'PASS',durationMs:Date.now()-t,...details});console.log('PASS '+name);}catch(e){evidence.tests.push({name,status:'FAIL',error:e.message});throw e;}}
async function blocked(waiter,locker,scenario){for(let i=0;i<60;i++){const x=await observer.json(`select row_to_json(x) from (select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=${waiter.pid}) x`);if(x.wait_event_type==='Lock'&&x.blockers.includes(locker.pid)){evidence.waits.push({scenario,blockerPid:locker.pid,...x});return;}await new Promise(r=>setTimeout(r,30));}throw Error('Independent lock wait not observed: '+scenario);}
const claim=(who=actor,before='a'.repeat(64))=>`select public.dekez_collection_setup_claim(${q(company)},${q(who)},${q(operation)},${q(before)},${q('b'.repeat(64))},'dpl_SYNTHETICONLY')`;
const check=()=>`select public.dekez_collection_setup_check(${q(company)},${q(actor)},${q(operation)})`;
const finish=state=>`select public.dekez_collection_setup_finish(${q(company)},${q(actor)},${q(operation)},${q(state)})`;
async function provision(seconds=600){await observer.query(`truncate dekez_collections_private.callback_setup;
 insert into dekez_collections_private.callback_setup(id,company_id,channel,operation_key,approved_actor,created_at,expires_at)
 select ${q(operation)},${q(company)},'FALCON-D9NS9','rental_callback_v1',${q(actor)},t,t+interval '${seconds} seconds' from (select clock_timestamp() t) s`);}
async function lockRow(){await holder.query(`begin;select id from dekez_collections_private.callback_setup where id=${q(operation)} for update`);}
async function rejected(sql,pattern=/42501|permission denied|Admin|administrator/i,role='service_role'){const s=await session('negative',role);try{await assert.rejects(s.query(sql),pattern);return{pid:s.pid,rejected:true};}finally{s.close();}}
async function snapshot(){const tables=['companies','profiles','company_users','properties','rooms','tenants','tenancies','tenant_records','rent_bills','rental_invoice_line_items','payments','payment_submissions','whatsapp_conversations','rent_reminder_logs'];const result={};for(const t of tables)result[t]=await observer.json(`select coalesce(json_agg(t order by id),'[]') from public.${t} t`);result.user_module_permissions=await observer.json("select coalesce(json_agg(t order by profile_id,module_key),'[]') from public.user_module_permissions t");return result;}
async function main(){
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));port=listener.address().port;await new Promise(r=>listener.close(r));
 fs.writeFileSync(passfile,password,{mode:0o600});try{run('initdb',['-D',data,'-U','local_review','--auth-host=scram-sha-256','--auth-local=scram-sha-256','--pwfile='+passfile,'--encoding=UTF8','--locale=C']);}finally{fs.unlinkSync(passfile);}
 // Detached PostgreSQL inherits handles on Windows; ignore startup pipes and
 // retain its explicit local log. Always attempt safe shutdown after start.
 started=true;run('pg_ctl',['-D',data,'-l',path.join(work,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=20 -c log_lock_waits=on -c deadlock_timeout=100ms`,'-w','start'],{stdio:'ignore'});observer=await session('observer',null);
 evidence.server=await observer.json("select json_build_object('version',version(),'listen_addresses',current_setting('listen_addresses'),'port',current_setting('port'),'pid',pg_backend_pid())");
 const fixture=fs.readFileSync(path.join(repo,'tests/fixtures/rental-collection.cjs'),'utf8'),from=fixture.indexOf(' create table companies('),to=fixture.indexOf('`);',from);assert(from>0&&to>from);
 const fixtureSql=Function('id','return `'+fixture.slice(from,to)+'`')(id);
 await observer.query(`create role anon;create role authenticated;create role service_role bypassrls;
 create role fixture_migrator nologin createrole createdb bypassrls;grant usage,create on schema public to fixture_migrator;grant create on database postgres to fixture_migrator;
 set role fixture_migrator;${fixtureSql};reset role`);
 for(const filename of ['20261028025857_rental_collection_review.sql','20261028091044_rental_collection_pending_evidence.sql','20261028122044_rental_collection_callback_setup.sql']){
  const sql=fs.readFileSync(path.join(repo,'supabase/migrations',filename));run('psql',args(),{env:env(),input:Buffer.concat([Buffer.from('set role fixture_migrator;\n'),sql])});
  evidence.migrations.push({filename,sha256:crypto.createHash('sha256').update(sql).digest('hex'),unmodified:true,migrationRole:'fixture_migrator (non-superuser)'});
 }
 await observer.query(`insert into companies values(${q(company)});insert into company_users values(${q(id(199))},${q(company)},${q(actor)},${q(actor)},'super_admin','active')`);
 const original=await snapshot();a=await session('caller-a');b=await session('caller-b');holder=await session('operator-lock',null);
 evidence.callerPids=[a.pid,b.pid];assert.notEqual(a.pid,b.pid);
 await test('migration creates no authorization and no direct table or browser RPC access',async()=>{
  assert.equal(await observer.json('select count(*)::int from dekez_collections_private.callback_setup'),0);
  const rls=await observer.json("select json_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity) from pg_class where oid='dekez_collections_private.callback_setup'::regclass");assert.deepEqual(rls,{enabled:true,forced:true});
  for(const role of ['anon','authenticated','service_role'])await rejected('select * from dekez_collections_private.callback_setup',/42501|permission denied/,role);
  for(const role of ['anon','authenticated'])await rejected(check(),/42501|permission denied/,role);
  const grants=await observer.json("select json_build_object('insert',has_table_privilege('dekez_collection_executor','dekez_collections_private.callback_setup','INSERT'),'delete',has_table_privilege('dekez_collection_executor','dekez_collections_private.callback_setup','DELETE'),'expiry_update',has_column_privilege('dekez_collection_executor','dekez_collections_private.callback_setup','expires_at','UPDATE'))");assert.deepEqual(grants,{insert:false,delete:false,expiry_update:false});return{rls};
 });
 await test('two independent simultaneous claims have exactly one winner',async()=>{
  await provision();await a.query('begin');const first=await a.json(claim());const pending=b.json(claim());await blocked(b,a,'same authorization');await a.query('commit');const second=await pending;
  assert.equal(first.state,'claimed');assert.equal(second.state,'used');assert.equal((await a.json(check())).state,'consumed');return{first,second};
 });
 await test('different simultaneous settings snapshots cannot make a second claim',async()=>{
  await provision();await a.query('begin');await a.json(claim());const pending=b.json(claim(actor,'c'.repeat(64)));await blocked(b,a,'changed snapshot');await a.query('commit');assert.equal((await pending).state,'used');
  assert.equal(await observer.json('select to_json(before_hash) from dekez_collections_private.callback_setup'),'a'.repeat(64));
 });
 await test('uncommitted rollback allows only the remaining committed winner',async()=>{
  await provision();await a.query('begin');await a.json(claim());const pending=b.json(claim());await blocked(b,a,'rolled back reservation');await a.query('rollback');assert.equal((await pending).state,'claimed');
 });
 await test('expiry is rechecked after an actual row-lock wait',async()=>{
  await provision(0.8);await lockRow();const pending=b.json(claim());await blocked(b,holder,'expiry while waiting');await observer.query('select pg_sleep(1)');await holder.query('commit');assert.equal((await pending).state,'expired');
  assert.equal(await observer.json('select to_json(consumed_at is null) from dekez_collections_private.callback_setup'),true);
 });
 await test('operator revocation during row-lock wait denies consumption',async()=>{
  await provision();await lockRow();const pending=b.json(claim());await blocked(b,holder,'revocation while waiting');await holder.query('update dekez_collections_private.callback_setup set revoked_at=clock_timestamp();commit');assert.equal((await pending).state,'revoked');
 });
 await test('Super Admin demotion during row-lock wait rolls consumption back',async()=>{
  await provision();await lockRow();const s=await session('demoted');const pending=assert.rejects(s.query(claim()),/42501|Super Admin/);await blocked(s,holder,'demotion while waiting');
  await observer.query(`update profiles set role='admin' where id=${q(actor)}`);await holder.query('commit');await pending;s.close();await observer.query(`update profiles set role='super_admin' where id=${q(actor)}`);
  assert.equal(await observer.json('select to_json(consumed_at is null) from dekez_collections_private.callback_setup'),true);
 });
 await test('company access revocation during row-lock wait rolls consumption back',async()=>{
  await provision();await lockRow();const s=await session('scope-revoked');const pending=assert.rejects(s.query(claim()),/42501|administrator/);await blocked(s,holder,'membership revoked while waiting');
  await observer.query(`update company_users set status='inactive' where id=${q(id(199))}`);await holder.query('commit');await pending;s.close();await observer.query(`update company_users set status='active' where id=${q(id(199))}`);
  assert.equal(await observer.json('select to_json(consumed_at is null) from dekez_collections_private.callback_setup'),true);
 });
 await test('explicit admin_setup restriction during wait is enforced',async()=>{
  await provision();await lockRow();const s=await session('module-restricted');const pending=assert.rejects(s.query(claim()),/42501|Super Admin/);await blocked(s,holder,'module restricted while waiting');
  await observer.query(`insert into user_module_permissions values(${q(actor)},'admin_setup','none')`);await holder.query('commit');await pending;s.close();await observer.query(`delete from user_module_permissions where profile_id=${q(actor)} and module_key='admin_setup'`);
  assert.equal(await observer.json('select to_json(consumed_at is null) from dekez_collections_private.callback_setup'),true);
 });
 await test('five-second lock timeout fails closed without consuming',async()=>{
  await provision();await lockRow();const s=await session('lock-timeout');const pending=assert.rejects(s.query(claim()),/55P03|lock timeout/);await blocked(s,holder,'bounded lock wait');await pending;await holder.query('rollback');s.close();
  assert.equal(await observer.json('select to_json(consumed_at is null) from dekez_collections_private.callback_setup'),true);
 });
 await test('uncertain completion is immutable and never opens a retry',async()=>{
  await provision();await a.json(claim());await a.query('begin');const first=await a.json(finish('uncertain'));const pending=b.json(finish('uncertain'));await blocked(b,a,'same terminal result');await a.query('commit');assert.equal(first.state,'recorded');assert.equal((await pending).state,'already_finished');
  await rejected(finish('verified'),/immutable/);assert.equal((await a.json(claim())).state,'used');
 });
 await test('scope and operator-selected actor cannot be spoofed',async()=>{
  await provision();await rejected(claim(id(4)));await rejected(check().replace(company,id(1)),/Approved callback setup scope/);
  assert.equal((await a.json(claim().replace(operation,id(999)))).state,'missing');assert.equal((await a.json(check())).state,'ready');
 });
 await test('actual cleanup revokes future-dated permit and RPC access without deleting history or other functions',async()=>{
  await provision();await observer.query("update dekez_collections_private.callback_setup set created_at=created_at+interval '5 minutes',expires_at=expires_at+interval '5 minutes'");
  assert.equal((await a.json(check())).state,'expired');
  const script=fs.readFileSync(path.join(repo,'scripts/retire-rental-callback-setup.sql'));
  const memberships=async()=>observer.json("select coalesce(jsonb_agg(to_jsonb(m) order by m.grantor),'[]'::jsonb) from pg_auth_members m where m.roleid='dekez_collection_executor'::regrole and m.member='fixture_migrator'::regrole");
  const originalMemberships=await memberships();
  run('psql',args(),{env:env(),input:Buffer.concat([Buffer.from('set role fixture_migrator;\n'),script])});
  assert.deepEqual(await memberships(),originalMemberships);
  for(const signature of ['public.dekez_collection_setup_assert_admin(uuid,uuid)','public.dekez_collection_setup_check(uuid,uuid,uuid)',
    'public.dekez_collection_setup_claim(uuid,uuid,uuid,text,text,text)','public.dekez_collection_setup_finish(uuid,uuid,uuid,text)',
    'dekez_collections_private.setup_check(uuid,uuid,uuid)','dekez_collections_private.setup_claim(uuid,uuid,uuid,text,text,text)',
    'dekez_collections_private.setup_finish(uuid,uuid,uuid,text)'])
    assert.equal(await observer.json(`select to_json(has_function_privilege('service_role',${q(signature)},'EXECUTE'))`),false,signature);
  evidence.cleanupScript={filename:'scripts/retire-rental-callback-setup.sql',sha256:crypto.createHash('sha256').update(script).digest('hex'),unmodified:true};
  await rejected(check(),/42501|permission denied/);await rejected(claim(),/42501|permission denied/);
  const row=await observer.json('select json_build_object(\'id\',id,\'revoked_before_start\',revoked_at<created_at,\'consumed_at\',consumed_at) from dekez_collections_private.callback_setup');
  assert.deepEqual(row,{id:operation,revoked_before_start:true,consumed_at:null});
  assert.equal(await observer.json("select to_json(has_function_privilege('service_role','public.dekez_collection_assert_admin(uuid,uuid)','EXECUTE'))"),true);
 });
 const originalPermit='5770722d-fb7a-4992-84aa-ef1186d24da9',v2Operation=id(201);
 let originalPermitSnapshot;
 await test('reviewed v2 migration preserves retired v1; two operator sessions cannot issue twice',async()=>{
  // Synthetic fixture only: model the exact unused/revoked production precondition.
  await observer.query(`update dekez_collections_private.callback_setup set id=${q(originalPermit)}`);
  originalPermitSnapshot=await observer.json(`select to_json(t) from dekez_collections_private.callback_setup t where id=${q(originalPermit)}`);
  const filename='20261029091616_rental_callback_v2_reviewed_slot.sql',migration=fs.readFileSync(path.join(repo,'supabase/migrations',filename));
  run('psql',args(),{env:env(),input:Buffer.concat([Buffer.from('set role fixture_migrator;\n'),migration])});
  evidence.migrations.push({filename,sha256:crypto.createHash('sha256').update(migration).digest('hex'),unmodified:true,migrationRole:'fixture_migrator (non-superuser)'});
  assert.equal(await observer.json('select count(*)::int from dekez_collections_private.callback_setup'),1);
  await rejected(check(),/42501|permission denied/);
  const issuance=fs.readFileSync(path.join(repo,'scripts/authorize-rental-callback-setup-v2.sql'),'utf8');
  evidence.authorizationScript={filename:'scripts/authorize-rental-callback-setup-v2.sql',sha256:crypto.createHash('sha256').update(issuance).digest('hex'),unmodified:true};
  const issuerA=await session('issuer-a','fixture_migrator'),issuerB=await session('issuer-b','fixture_migrator');
  const parameters=`select set_config('dekez.callback_v2.actor',${q(actor)},false),set_config('dekez.callback_v2.operation',${q(v2Operation)},false);`;
  await issuerA.query(parameters);await issuerB.query(parameters);
  // Keep the real script transaction open only in this synthetic fixture so the
  // second actual session demonstrably waits on its exclusive ledger lock.
  await issuerA.query(issuance.replace(/commit;\s*$/,''));
  const pending=assert.rejects(issuerB.query(issuance),/must be retired|lifetime authorization/);
  await blocked(issuerB,issuerA,'concurrent bounded v2 issuance');await issuerA.query('commit');await pending;
  issuerA.close();issuerB.close();
  assert.equal(await observer.json('select count(*)::int from dekez_collections_private.callback_setup'),2);
  assert.deepEqual(await observer.json(`select to_json(t) from dekez_collections_private.callback_setup t where id=${q(originalPermit)}`),originalPermitSnapshot);
  assert.equal(await observer.json(`select to_json(expires_at-created_at=interval '10 minutes') from dekez_collections_private.callback_setup where id=${q(v2Operation)}`),true);
  assert.equal((await a.json(check().replace(operation,originalPermit))).state,'revoked');
  return{issuancePids:[issuerA.pid,issuerB.pid],permits:2,oldPermitUnchanged:true};
 });
 await test('v2 independent claims have one winner; same retirement revokes all seven grants and retains both records',async()=>{
  const v2Claim=claim().replace(operation,v2Operation);
  await a.query('begin');const first=await a.json(v2Claim);const pending=b.json(v2Claim);
  await blocked(b,a,'v2 same authorization');await a.query('commit');const second=await pending;
  assert.equal(first.state,'claimed');assert.equal(second.state,'used');
  await a.json(finish('uncertain').replace(operation,v2Operation));
  await rejected(finish('verified').replace(operation,v2Operation),/immutable/);
  const script=fs.readFileSync(path.join(repo,'scripts/retire-rental-callback-setup.sql'));
  run('psql',args(),{env:env(),input:Buffer.concat([Buffer.from('set role fixture_migrator;\n'),script])});
  assert.equal(await observer.json('select count(*)::int from dekez_collections_private.callback_setup where revoked_at is not null'),2);
  assert.deepEqual(await observer.json(`select to_json(t) from dekez_collections_private.callback_setup t where id=${q(originalPermit)}`),originalPermitSnapshot);
  await rejected(v2Claim,/42501|permission denied/);
  assert.equal(await observer.json(`select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where ((n.nspname='public' and p.proname in ('dekez_collection_setup_assert_admin','dekez_collection_setup_check','dekez_collection_setup_claim','dekez_collection_setup_finish'))
    or(n.nspname='dekez_collections_private' and p.proname in ('setup_check','setup_claim','setup_finish')))
   and (has_function_privilege('service_role',p.oid,'EXECUTE') or has_function_privilege('anon',p.oid,'EXECUTE') or has_function_privilege('authenticated',p.oid,'EXECUTE'))`),0);
  return{callerPids:[a.pid,b.pid],first:first.state,second:second.state,allSevenRetired:true};
 });
 await test('business, consent, delivery, scan and prior reporting data are unchanged',async()=>{
  assert.deepEqual(await snapshot(),original);
  for(const table of ['controls','contact_controls','number_suppressions','attempts','failure_reports','worker_runs','audit'])assert.equal(await observer.json(`select count(*)::int from dekez_collections_private.${table}`),0,table);
  const role=await observer.json("select json_build_object('create_schema',has_schema_privilege('dekez_collection_executor','dekez_collections_private','CREATE'),'superuser',rolsuper,'bypass',rolbypassrls,'login',rolcanlogin) from pg_roles where rolname='dekez_collection_executor'");assert.deepEqual(role,{create_schema:false,superuser:false,bypass:false,login:false});return{unchangedSourceTables:Object.keys(original).length,providerCalls:0};
 });
 evidence.status='PASS';
}
main().catch(e=>{evidence.status='FAIL';evidence.error=e.message;process.exitCode=1;console.error(e.message);}).finally(async()=>{
 for(const s of clients)s.close();if(started){try{evidence.shutdown=run('pg_ctl',['-D',data,'-m','fast','-w','stop']);}catch(e){evidence.shutdownError=e.message;process.exitCode=1;}}
 evidence.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(root,'native-results.json'),JSON.stringify(evidence,null,2)+'\n');
});
