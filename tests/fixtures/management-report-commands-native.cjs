// Optional native PostgreSQL concurrency proof. Creates a fresh localhost-only
// cluster with synthetic records. No app credentials, provider calls or remote DB.
// Usage: node <this-file> --pg-bin <PostgreSQL/bin> --output-dir <evidence-folder>
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const option=name=>{const at=process.argv.indexOf(name);return at>=0?process.argv[at+1]:null;};
const bin=option('--pg-bin'),output=option('--output-dir');
if(!bin||!output)throw Error('Explicit --pg-bin and --output-dir are required; no external database connection is accepted.');
const repo=path.resolve(__dirname,'../..'),root=path.resolve(output);
fs.mkdirSync(root,{recursive:true});
const work=fs.mkdtempSync(path.join(root,'isolated-')),data=path.join(work,'cluster'),passfile=path.join(work,'ephemeral-init-password');
const pass=crypto.randomBytes(32).toString('hex');
const evidence={startedAt:new Date().toISOString(),scope:'Isolated native PostgreSQL; independent sessions; synthetic records; zero provider calls',tests:[],waits:[],migrations:[]};
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const q=v=>"'"+String(v).replaceAll("'","''")+"'";
const binary=name=>path.join(path.resolve(bin),name+(process.platform==='win32'?'.exe':''));
let port,started=false,control,a,b;const clients=new Set();
const args=()=>['-h','127.0.0.1','-p',String(port),'-U','local_review','-d','postgres','-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const env=()=>{const value={...process.env};for(const key of Object.keys(value))if(key.startsWith('PG'))delete value[key];return {...value,PGPASSWORD:pass,PGCONNECT_TIMEOUT:'5',PGHOST:'127.0.0.1',PGPORT:String(port),PGDATABASE:'postgres',PGUSER:'local_review'};};
function run(name,argv,options={}){const r=spawnSync(binary(name),argv,{encoding:'utf8',windowsHide:true,timeout:60000,...options});if(r.status!==0)throw Error(name+' failed: '+(r.stderr||r.stdout||r.error));return r.stdout;}
class Session{
 constructor(name){this.name=name;this.out='';this.err='';this.pending=null;this.child=spawn(binary('psql'),args(),{env:env(),windowsHide:true,stdio:['pipe','pipe','pipe']});clients.add(this);
  this.child.stdout.on('data',x=>{this.out+=x.toString();this.flush();});this.child.stderr.on('data',x=>{this.err+=x.toString();});
  this.child.on('close',code=>{clients.delete(this);if(this.pending){this.pending.reject(Error(this.err||'Session closed '+code));this.pending=null;}});
  this.child.on('error',e=>{if(this.pending){this.pending.reject(e);this.pending=null;}});
 }
 flush(){const p=this.pending;if(!p)return;const at=this.out.indexOf(p.marker);if(at<0)return;const result=this.out.slice(0,at).trim();this.out=this.out.slice(at+p.marker.length).replace(/^\r?\n/,'');this.pending=null;p.resolve(result);}
 query(sql){assert.equal(this.pending,null,'Each independent backend has one query at a time');const marker='END_'+crypto.randomBytes(10).toString('hex');return new Promise((resolve,reject)=>{this.pending={resolve,reject,marker};this.child.stdin.write(sql+`;\nselect '${marker}';\n`);this.flush();});}
 async json(sql){return JSON.parse(await this.query(sql));}
 close(){if(!this.child.killed)this.child.stdin.end('\\q\n');}
}
async function fresh(name,role){const s=new Session(name);if(role)await s.query('set role '+role);s.pid=Number(await s.query('select pg_backend_pid()'));return s;}
const claim=(message,company=id(1))=>`select public.dekez_report_command_claim(${q(company)},'FALCON-D9NS9',${q(message)},'60198894911','60198894911@s.whatsapp.net','full',clock_timestamp())`;
const counts=()=>control.json("select json_build_object('total',count(*),'processing',count(*) filter(where state='processing'),'rate_limited',count(*) filter(where state='rate_limited')) from dekez_reports_private.command_requests");
async function reset(){await control.query('truncate dekez_reports_private.command_requests');}
async function blocked(waiter,blocker,label){for(let i=0;i<40;i++){
 const row=await control.json(`select row_to_json(s) from (select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=${waiter.pid}) s`);
 if(row.wait_event_type==='Lock'&&row.blockers.includes(blocker.pid)){evidence.waits.push({scenario:label,blockerPid:blocker.pid,...row});return row;}
 await new Promise(r=>setTimeout(r,30));
 }throw Error('Independent backend lock wait was not observed: '+label);}
async function check(name,fn){const start=Date.now();try{const detail=await fn();evidence.tests.push({name,status:'PASS',durationMs:Date.now()-start,...detail});console.log('PASS '+name);}catch(e){evidence.tests.push({name,status:'FAIL',error:e.message});throw e;}}
async function main(){
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));port=listener.address().port;await new Promise(r=>listener.close(r));
 fs.writeFileSync(passfile,pass,{mode:0o600});
 try{run('initdb',['-D',data,'-U','local_review','--auth-host=scram-sha-256','--auth-local=scram-sha-256','--pwfile='+passfile,'--encoding=UTF8','--locale=C']);}finally{fs.unlinkSync(passfile);}
 run('pg_ctl',['-D',data,'-l',path.join(work,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port} -c max_connections=20 -c log_lock_waits=on -c deadlock_timeout=100ms`,'-w','start'],{stdio:'ignore'});started=true;
 control=await fresh('observer');
 evidence.server=await control.json("select json_build_object('version',version(),'listen_addresses',current_setting('listen_addresses'),'port',current_setting('port'),'observerPid',pg_backend_pid())");
 const fixture=fs.readFileSync(path.join(repo,'tests/fixtures/management-report.cjs'),'utf8');
 const start=fixture.indexOf(' create table companies('),end=fixture.indexOf('`);',start);assert(start>0&&end>start);
 const source=Function('id','return `'+fixture.slice(start,end)+'`')(id);
 await control.query(`create role anon;create role authenticated;create role service_role bypassrls;create role fixture_migrator nologin createrole createdb bypassrls;grant usage,create on schema public to fixture_migrator;grant create on database postgres to fixture_migrator;set role fixture_migrator;${source};reset role;`);
 const sourceTables=['companies','profiles','properties','tenants','tenancies','tenant_records','payments','rent_bills','rental_invoice_line_items','payment_submissions','rooms','maintenance_tickets'];
 const capture=async()=>Object.fromEntries(await Promise.all(sourceTables.map(async table=>{const s=await fresh('capture');try{return [table,await s.json(`select coalesce(json_agg(x order by id),'[]') from public.${table} x`)];}finally{s.close();}})));
 const original=await capture();
 for(const name of ['20261025083739_whapi_management_reports.sql','20261025145221_whapi_single_use_test_authorization.sql','20261026023135_whapi_report_personal_recipient.sql','20261026115436_whapi_reporting_commands.sql']){
  const sql=fs.readFileSync(path.join(repo,'supabase/migrations',name),'utf8');
  run('psql',[...args(),'-c','set role fixture_migrator;'+sql],{env:env()});
  evidence.migrations.push({filename:name,sha256:crypto.createHash('sha256').update(sql).digest('hex'),unmodified:true,migrationRole:'fixture_migrator (non-superuser)'});
 }
 a=await fresh('caller-a','service_role');b=await fresh('caller-b','service_role');assert.notEqual(a.pid,b.pid);assert.notEqual(a.pid,control.pid);
 evidence.callerPids={a:a.pid,b:b.pid};
 await check('two independent sessions cannot both claim the same provider message',async()=>{
  await reset();await a.query('begin');const first=await a.json(claim('same-message'));assert.equal(first.claimed,true);
  const pending=b.json(claim('same-message'));await blocked(b,a,'same message advisory lock');await a.query('commit');const second=await pending;
  assert.deepEqual(second,{claimed:false,state:'duplicate'});assert.deepEqual(await counts(),{total:1,processing:1,rate_limited:0});return {first,second,counts:await counts(),backendPids:[a.pid,b.pid]};
 });
 await check('rolled-back reservation permits exactly one committed winner',async()=>{
  await reset();await a.query('begin');const first=await a.json(claim('rolled-back'));
  const pending=b.json(claim('rolled-back'));await blocked(b,a,'rollback releases claim');await a.query('rollback');const second=await pending;
  assert.equal(second.claimed,true);assert.notEqual(first.request_id,second.request_id);assert.deepEqual(await counts(),{total:1,processing:1,rate_limited:0});return {aborted:first.request_id,committed:second.request_id,counts:await counts()};
 });
 await check('seven independent simultaneous messages authorize at most six claims per minute',async()=>{
  await reset();const gate=await fresh('rate-limit-gate');await gate.query('begin');await gate.query(`select pg_advisory_xact_lock(hashtextextended('dekez-report-command:${id(1)}:60198894911',0))`);
  const workers=[];const pending=[];
  for(let i=0;i<7;i++){const s=await fresh('rate-caller-'+i,'service_role');workers.push(s);pending.push(s.json(claim('parallel-'+i)));}
  assert.equal(new Set(workers.map(s=>s.pid)).size,7);
  await blocked(workers[0],gate,'seven simultaneous rate-limit requests');await gate.query('commit');gate.close();
  const results=await Promise.all(pending);workers.forEach(s=>s.close());
  assert.equal(results.filter(r=>r.claimed).length,6);assert.equal(results.filter(r=>r.state==='rate_limited').length,1);
  assert.deepEqual(await counts(),{total:7,processing:6,rate_limited:1});return {backendPids:workers.map(s=>s.pid),results,counts:await counts()};
 });
 await check('provider-message uniqueness prevents cross-company concurrent replay',async()=>{
  await reset();await a.query('begin');const first=await a.json(claim('cross-company',id(1)));
  const pending=b.json(claim('cross-company',id(2)));await blocked(b,a,'global provider-message unique key');await a.query('commit');const second=await pending;
  assert.equal(first.claimed,true);assert.deepEqual(second,{claimed:false,state:'duplicate'});assert.deepEqual(await counts(),{total:1,processing:1,rate_limited:0});return {firstCompany:id(1),replayCompany:id(2),second,counts:await counts()};
 });
 await check('two independent sessions cannot both prepare an external send; exact audit survives interruption',async()=>{
  await reset();const r=await a.json(claim('prepare-once'));
  const snapshot=JSON.stringify({company_id:id(1),report_date:r.report_date});
  const prepare=`select public.dekez_report_command_prepare(${q(r.request_id)},${q(snapshot)}::jsonb,'Synthetic exact report body')`;
  await a.query('begin');const first=await a.json(prepare);assert.equal(first.prepared,true);
  const pending=b.json(prepare);await blocked(b,a,'one-shot preparation row lock');await a.query('commit');const second=await pending;
  assert.deepEqual(second,{prepared:false,state:'already_prepared'});
  const stored=await control.json(`select row_to_json(r) from (select state,snapshot,message_body,prepared_at is not null prepared from dekez_reports_private.command_requests where id=${q(r.request_id)}) r`);
  assert.equal(stored.state,'processing');assert.equal(stored.message_body,'Synthetic exact report body');assert.equal(stored.prepared,true);return {first,second,stored,providerCalls:0};
 });
 await check('five-second database lock timeout fails closed without creating a second claim',async()=>{
  await reset();await a.query('begin');await a.json(claim('lock-holder'));
  const start=Date.now(),pending=b.query(claim('lock-waiter')).then(value=>({value}),error=>({error:error.message}));
  await blocked(b,a,'bounded command lock timeout');const denied=await pending;const elapsed=Date.now()-start;
  assert.match(denied.error,/55P03[\s\S]*lock timeout/);assert(elapsed>=4500&&elapsed<9000);
  await a.query('commit');b=await fresh('caller-b-after-timeout','service_role');assert.deepEqual(await counts(),{total:1,processing:1,rate_limited:0});return {elapsedMs:elapsed,error:denied.error.split('\n')[0],counts:await counts()};
 });
 await check('business records and existing reporting ledgers remain untouched; no source write privileges',async()=>{
  assert.deepEqual(await capture(),original);
  for(const table of sourceTables)for(const privilege of ['INSERT','UPDATE','DELETE']){
   assert.equal(await control.query(`select has_table_privilege('dekez_report_executor',${q('public.'+table)},${q(privilege)})`),'f');
  }
  const otherCounts=await control.json("select json_build_object('report_runs',(select count(*) from dekez_reports_private.report_runs),'delivery_attempts',(select count(*) from dekez_reports_private.delivery_attempts),'test_authorizations',(select count(*) from dekez_reports_private.test_authorizations))");
  assert.deepEqual(otherCounts,{report_runs:0,delivery_attempts:0,test_authorizations:0});
  const deadlocks=Number(await control.query("select deadlocks from pg_stat_database where datname=current_database()"));assert.equal(deadlocks,0);
  return {sourceTablesUnchanged:sourceTables,existingReportLedgerCounts:otherCounts,deadlocks,providerCalls:0};
 });
 evidence.status='PASS';
}
main().catch(error=>{evidence.status='FAIL';evidence.error=error.stack;console.error(error.stack);process.exitCode=1;}).finally(()=>{
 for(const s of clients)s.close();
 if(started){try{evidence.shutdown=run('pg_ctl',['-D',data,'-m','fast','-w','stop']).trim();}catch(error){evidence.shutdownError=error.message;process.exitCode=1;}}
 evidence.finishedAt=new Date().toISOString();const resultPath=path.join(root,'native-results.json');fs.writeFileSync(resultPath,JSON.stringify(evidence,null,2));console.log('Evidence: '+resultPath);
});
