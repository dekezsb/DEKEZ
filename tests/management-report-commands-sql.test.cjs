// Synthetic in-memory PostgreSQL only. No network, production credentials or sends.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const fixture=require('./fixtures/management-report.cjs');
const migrationPath='supabase/migrations/20261026115436_whapi_reporting_commands.sql';
const sql=fs.readFileSync(migrationPath,'utf8');
const baseSql=fs.readFileSync('supabase/migrations/20261025083739_whapi_management_reports.sql','utf8');
const tables=['companies','profiles','properties','tenants','tenancies','tenant_records','payments','rent_bills','rental_invoice_line_items','payment_submissions','rooms','maintenance_tickets'];
const recipient='60198894911',chat=recipient+'@s.whatsapp.net',channel='FALCON-D9NS9';
let db,id,baselineRows,baselineSecurity;
const rpc=async(name,args)=>(await db.rpcQuery(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) result`,args)).rows[0].result;
const now=async()=>(await db.query('select clock_timestamp() t')).rows[0].t;
const claim=async(message='synthetic.1',changes={})=>{
 const p={company:id(1),channel,message,sender:recipient,chat,command:'due_overdue',received:await now(),...changes};
 return rpc('dekez_report_command_claim',[p.company,p.channel,p.message,p.sender,p.chat,p.command,p.received]);
};
const finish=(request,state='accepted',changes={})=>{
 const p={snapshot:{company_id:id(1),report_date:request.report_date},body:'Synthetic totals only',provider:'synthetic-provider.1',http:200,error:null,...changes};
 return rpc('dekez_report_command_finish',[request.request_id,state,p.snapshot,p.body,p.provider,p.http,p.error]);
};
const prepare=(request,snapshot={company_id:id(1),report_date:request.report_date},body='Synthetic totals only')=>
 rpc('dekez_report_command_prepare',[request.request_id,snapshot,body]);
const captureRows=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.query(`select * from public.${t} order by id`)).rows])));
const oldSecurity=async()=>({
 functions:(await db.query(`select n.nspname,p.proname,p.oid,p.proowner,p.proacl,p.proconfig,p.prosecdef,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='dekez_reports_private' and p.proname not like 'command_%') or (n.nspname='public' and p.proname like 'dekez_management_report_%') order by n.nspname,p.proname`)).rows,
 tables:(await db.query("select c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity from pg_class c where c.relnamespace='dekez_reports_private'::regnamespace and c.relkind='r' and c.relname<>'command_requests' order by c.relname")).rows,
 policies:(await db.query("select * from pg_policies where tablename<>'command_requests' order by schemaname,tablename,policyname")).rows,
 memberships:(await db.query("select * from pg_auth_members where roleid='dekez_report_executor'::regrole order by roleid,member,grantor")).rows,
});
test.before(async()=>{
 db=await fixture({recipientMigration:true});id=db.id;
 baselineRows=await captureRows();baselineSecurity=await oldSecurity();
 await db.exec('set role fixture_migrator');await db.exec(sql);await db.exec('reset role');
});
test.after(async()=>{await db?.close();});
test.beforeEach(async()=>{await db.exec('truncate dekez_reports_private.command_requests');});

test('additive migration preserves all applied SQL, source rows, previous functions, policies and memberships',async()=>{
 assert.deepEqual(await captureRows(),baselineRows);assert.deepEqual(await oldSecurity(),baselineSecurity);
 for(const [file,hash] of [
  ['20261025083739_whapi_management_reports.sql','3dd63a191dc0a0901dde637c3b8e4a51beccfc5a2658a184d1466ea9356c0b75'],
  ['20261025145221_whapi_single_use_test_authorization.sql','63c2c41c4eaa214d631b2a27f5dde96a862fa04d32397ca130e10ba34830effc'],
 ])assert.equal(crypto.createHash('sha256').update(fs.readFileSync('supabase/migrations/'+file)).digest('hex'),hash);
 assert.match(sql,/set local lock_timeout = '5s'/);assert.match(sql,/set local statement_timeout = '30s'/);
 assert.doesNotMatch(sql,/\b(?:update|insert into|delete from|alter table|drop table)\s+public\.|\b(?:truncate|http_post|net\.http|cron\.schedule)\b/i);
 assert.equal((await db.query('select count(*) n from dekez_reports_private.command_requests')).rows[0].n,0);
 assert.deepEqual(db.migrationIdentity,{current_user:'fixture_migrator',rolsuper:false});
});

test('read-only due report copies the reviewed bill eligibility, balance and canonical-person CTE exactly',()=>{
 const cte=text=>text.split('bill_balances as materialized (')[1].split('), balances as (')[0];
 assert.equal(cte(sql),cte(baseSql));
});

test('private command ledger has forced RLS and no direct public, browser or service-role access',async()=>{
 const row=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='dekez_reports_private.command_requests'::regclass")).rows[0];
 assert.deepEqual(row,{relrowsecurity:true,relforcerowsecurity:true});
 for(const role of ['anon','authenticated','service_role']){
  for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']){
   assert.equal((await db.query("select has_table_privilege($1,'dekez_reports_private.command_requests',$2) allowed",[role,privilege])).rows[0].allowed,false,role+' '+privilege);
  }
  await db.exec(`begin; set local role ${role}`);
  try{await assert.rejects(db.query('select * from dekez_reports_private.command_requests'),/permission denied/);}
  finally{await db.exec('rollback');}
 }
});

test('private definers are narrow no-login executor functions; public wrappers are invokers with service-only execution',async()=>{
 const funcs=(await db.query("select n.nspname,p.proname,p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='dekez_reports_private' and p.proname like 'command_%') or (n.nspname='public' and p.proname in ('dekez_report_command_claim','dekez_report_command_prepare','dekez_report_command_finish','dekez_report_due_snapshot'))")).rows;
 assert.equal(funcs.length,7);
 for(const f of funcs){
  assert.ok(f.proconfig.includes('search_path=""'),f.proname);
  assert.equal(f.prosecdef,f.nspname==='dekez_reports_private');
  if(f.prosecdef){assert.equal(f.owner,'dekez_report_executor');assert.ok(f.proconfig.includes('row_security=on'));}
  for(const role of ['anon','authenticated'])assert.equal((await db.query('select has_function_privilege($1,$2::oid,\'EXECUTE\') allowed',[role,f.oid])).rows[0].allowed,false);
  assert.equal((await db.query('select has_function_privilege(\'service_role\',$1::oid,\'EXECUTE\') allowed',[f.oid])).rows[0].allowed,true);
 }
 const executor=(await db.query("select rolcanlogin,rolinherit,rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls,has_schema_privilege(rolname,'dekez_reports_private','CREATE') schema_create from pg_roles where rolname='dekez_report_executor'")).rows[0];
 for(const value of Object.values(executor))assert.equal(value,false);
 for(const table of tables)assert.equal((await db.query('select has_table_privilege(\'dekez_report_executor\',$1,\'UPDATE\') allowed',['public.'+table])).rows[0].allowed,false);
 await assert.rejects(db.query("select dekez_reports_private.command_claim($1,$2,$3,$4,$5,$6,clock_timestamp())",[id(1),channel,'bad-role',recipient,chat,'full']),/Reporting server role required/);
});

test('ordinary identities cannot invoke any command RPC or use forged request claims to gain access',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec(`begin; set local role ${role}; set local request.jwt.claim.role='service_role'`);
  try{await assert.rejects(db.query('select public.dekez_report_due_snapshot($1,clock_timestamp())',[id(1)]),/permission denied/);}
  finally{await db.exec('rollback');}
 }
});

test('claim accepts only the fixed verified channel, sender, direct chat and predefined commands',async()=>{
 for(const changes of [
  {company:id(999)},{channel:'OTHER'},{channel:null},{sender:'60168173911'},{sender:'0198894911'},
  {sender:null},{chat:'60198894911@g.us'},{chat:'60168173911@s.whatsapp.net'},{chat:null},
  {command:'select * from tenants'},{command:null},{message:'bad/id'},{message:''},{message:'a'.repeat(201)},
 ])await assert.rejects(claim('invalid',changes),/Invalid report|Invalid reporting command/);
 assert.equal((await db.query('select count(*) n from dekez_reports_private.command_requests')).rows[0].n,0);
 const r=await claim('provider.message_123-abc');assert.equal(r.claimed,true);assert.equal(r.state,'processing');
 assert.match(r.report_date,/^\d{4}-\d{2}-\d{2}$/);
});

test('freshness uses database time, rejects stale/future/infinite timestamps, and generation date is current Malaysia date',async()=>{
 const clock=new Date(await now());
 for(const received of [new Date(clock.getTime()-16*60000).toISOString(),new Date(clock.getTime()+61000).toISOString(),'infinity',null]){
  await assert.rejects(claim('bad-time',{received}),/Stale reporting command|Invalid reporting command/);
 }
 const r=await claim('fresh',{received:new Date(clock.getTime()-14*60000).toISOString()});
 const expected=(await db.query("select to_char(clock_timestamp() at time zone 'Asia/Kuala_Lumpur','YYYY-MM-DD') d")).rows[0].d;
 assert.equal(r.report_date,expected);
});

test('permanent provider-message dedupe precedes rate limits and cannot be re-scoped to another company',async()=>{
 const first=await claim('same');assert.equal(first.claimed,true);
 assert.deepEqual(await claim('same'),{claimed:false,state:'duplicate'});
 assert.deepEqual(await claim('same',{company:id(2),command:'maintenance'}),{claimed:false,state:'duplicate'});
 await prepare(first);await finish(first);
 assert.deepEqual(await claim('same'),{claimed:false,state:'duplicate'});
 assert.equal((await db.query('select count(*) n from dekez_reports_private.command_requests')).rows[0].n,1);
});

test('six claims per rolling minute are allowed, seventh logged as rate-limited with no send authorization',async()=>{
 for(let i=0;i<6;i++)assert.equal((await claim('minute-'+i)).claimed,true);
 const limited=await claim('minute-6');assert.equal(limited.claimed,false);assert.equal(limited.state,'rate_limited');
 assert.deepEqual(await claim('minute-6'),{claimed:false,state:'duplicate'});
 assert.deepEqual(await claim('minute-0'),{claimed:false,state:'duplicate'});
 const rows=(await db.query('select state,count(*) n from dekez_reports_private.command_requests group by state order by state')).rows;
 assert.deepEqual(rows,[{state:'processing',n:6},{state:'rate_limited',n:1}]);
});

test('rolling hour allows thirty claims, including failures, but not thirty-one; limits expire without retrying old IDs',async()=>{
 for(let i=0;i<30;i++){
  const r=await claim('hour-'+i);assert.equal(r.claimed,true);
  if(i===0)await finish(r,'failed',{snapshot:null,body:null,provider:null,http:null,error:'report_unavailable'});
  await db.query("update dekez_reports_private.command_requests set created_at=clock_timestamp()-interval '2 minutes' where id=$1",[r.request_id]);
 }
 assert.equal((await claim('hour-30')).state,'rate_limited');
 await db.exec("update dekez_reports_private.command_requests set created_at=clock_timestamp()-interval '61 minutes' where state<>'rate_limited'");
 assert.equal((await claim('hour-31')).claimed,true);
 assert.deepEqual(await claim('hour-0'),{claimed:false,state:'duplicate'});
});

test('interrupted, rejected and uncertain claims never become reusable or automatically retryable',async()=>{
 for(const [index,state,error] of [[1,'rejected','provider_rejected'],[2,'uncertain','delivery_uncertain'],[3,'failed','worker_interrupted']]){
  const r=await claim('terminal-'+index);
  if(state!=='failed')await prepare(r);
  await finish(r,state,{provider:null,http:state==='rejected'?400:null,error});
  assert.deepEqual(await claim('terminal-'+index),{claimed:false,state:'duplicate'});
 }
 const r=await claim('interrupted');
 await db.query("update dekez_reports_private.command_requests set created_at=clock_timestamp()-interval '1 day' where id=$1",[r.request_id]);
 assert.deepEqual(await claim('interrupted'),{claimed:false,state:'duplicate'});
 assert.equal((await db.query('select state from dekez_reports_private.command_requests where id=$1',[r.request_id])).rows[0].state,'processing');
});

test('finish validates snapshot scope, bounds and outcomes, and cannot silently rewrite finalized history',async()=>{
 const r=await claim('finish');
 await assert.rejects(finish(r),/Command preparation required/);
 for(const changes of [
  {snapshot:{company_id:id(2),report_date:r.report_date}}, {snapshot:{company_id:id(1),report_date:'2000-01-01'}},
  {snapshot:null},{snapshot:[]},{snapshot:{company_id:id(1),report_date:r.report_date,padding:'a'.repeat(16000)}},
  {body:''},{body:'a'.repeat(4001)},{provider:'not/a/safe/id'},{provider:null},{http:500},{http:null},{error:'provider_rejected'},
 ])await assert.rejects(finish(r,'accepted',changes),/Invalid command|Command snapshot required/);
 await prepare(r);await finish(r);await finish(r);
 await assert.rejects(finish(r,'accepted',{body:'Edited audit history'}),/Prepared command audit cannot change/);
 await assert.rejects(finish(r,'uncertain',{provider:null,http:null,error:'delivery_uncertain'}),/already finalized/);
});

test('help can retain a bounded non-financial reply without pretending to hold a report snapshot',async()=>{
 const r=await claim('help',{command:'help'});await prepare(r,null,'Supported commands: full management report');await finish(r,'accepted',{snapshot:null,body:'Supported commands: full management report'});
 const row=(await db.query('select state,snapshot,message_body from dekez_reports_private.command_requests where id=$1',[r.request_id])).rows[0];
 assert.equal(row.state,'accepted');assert.equal(row.snapshot,null);assert.match(row.message_body,/Supported/);
});

test('preparation atomically stores exact content, validates scope and never grants a second send',async()=>{
 const r=await claim('prepare');
 for(const snapshot of [null,[],{company_id:id(2),report_date:r.report_date},{company_id:id(1),report_date:'2000-01-01'}]){
  await assert.rejects(prepare(r,snapshot),/Invalid command snapshot/);
 }
 for(const body of ['',null,'a'.repeat(4001)])await assert.rejects(prepare(r,undefined,body),/Invalid command body/);
 assert.deepEqual(await prepare(r),{prepared:true,body:'Synthetic totals only'});
 assert.deepEqual(await prepare(r),{prepared:false,state:'already_prepared'});
 assert.deepEqual(await prepare(r,{company_id:id(1),report_date:r.report_date},'Different text'),{prepared:false,state:'already_prepared'});
 const row=(await db.query('select state,snapshot,message_body,prepared_at from dekez_reports_private.command_requests where id=$1',[r.request_id])).rows[0];
 assert.equal(row.state,'processing');assert.equal(row.message_body,'Synthetic totals only');assert.ok(row.prepared_at);
 await assert.rejects(finish(r,'uncertain',{body:'Different body',provider:null,http:null,error:'delivery_uncertain'}),/Prepared command audit cannot change/);
 await finish(r,'uncertain',{provider:null,http:null,error:'delivery_uncertain'});
 assert.deepEqual(await prepare(r),{prepared:false,state:'already_prepared'});
});

test('due-today and overdue balances are disjoint, exclude deposits, include extras and count canonical tenants once',async()=>{
 const asOf='2026-10-25T12:00:00Z';
 const due=await rpc('dekez_report_due_snapshot',[id(1),asOf]);
 assert.deepEqual(due,{company_id:id(1),report_date:'2026-10-25',as_of:'2026-10-25T12:00:00+00:00',due_today:50,due_today_tenants:1,due_today_invoices:1,overdue:550,overdue_tenants:1,overdue_invoices:2,combined_tenants:1,missing_bill_context:0,missing_bill_amount:0});
 const daily=await rpc('dekez_management_report_snapshot',[id(1),asOf]);
 assert.equal(due.overdue,daily.overdue);assert.equal(due.overdue_tenants,daily.overdue_tenants);
 assert.equal(due.due_today+due.overdue,daily.outstanding);
 assert.equal(due.combined_tenants,1);assert.notEqual(due.combined_tenants,due.due_today_tenants+due.overdue_tenants);
 assert.equal(JSON.stringify(due).includes(id(4)),false,'No tenant identifier in aggregate');
});

test('Malaysia-local midnight moves an invoice from due today to overdue, not both',async()=>{
 const before=await rpc('dekez_report_due_snapshot',[id(1),'2026-10-25T15:59:59Z']);
 const after=await rpc('dekez_report_due_snapshot',[id(1),'2026-10-25T16:00:00Z']);
 assert.equal(before.report_date,'2026-10-25');assert.equal(before.due_today,50);
 assert.equal(after.report_date,'2026-10-26');assert.equal(after.due_today,0);assert.equal(after.overdue,600);
});

test('due aggregate is scoped, read-only and rejects unknown company/time',async()=>{
 const rowsBefore=await captureRows();
 const empty=await rpc('dekez_report_due_snapshot',[id(2),'2026-10-25T12:00:00Z']);
 for(const key of ['due_today','due_today_tenants','overdue','overdue_tenants','combined_tenants'])assert.equal(empty[key],0);
 await assert.rejects(rpc('dekez_report_due_snapshot',[id(999),'2026-10-25T12:00:00Z']),/Invalid report scope/);
 await assert.rejects(rpc('dekez_report_due_snapshot',[id(1),null]),/Invalid report scope/);
 assert.deepEqual(await captureRows(),rowsBefore);
});

test('missing invoice amounts or context are unavailable, never quietly treated as zero',async()=>{
 await db.query('update rent_bills set amount=null where id=$1',[id(201)]);
 try{
  const due=await rpc('dekez_report_due_snapshot',[id(1),'2026-10-25T12:00:00Z']);
  assert.equal(due.missing_bill_amount,1);assert.equal(due.due_today,null);assert.equal(due.overdue,null);assert.equal(due.combined_tenants,null);
 }finally{await db.query('update rent_bills set amount=500 where id=$1',[id(201)]);}
 await db.query('update rent_bills set due_date=null where id=$1',[id(202)]);
 try{
  const due=await rpc('dekez_report_due_snapshot',[id(1),'2026-10-25T12:00:00Z']);
  assert.equal(due.missing_bill_context,1);assert.equal(due.due_today_tenants,null);assert.equal(due.overdue_invoices,null);
 }finally{await db.query("update rent_bills set due_date='2026-10-21' where id=$1",[id(202)]);}
});

test('draft, removed, waived, cancelled, future and unissued bills are excluded without dropping paid-status extras',async()=>{
 for(const [column,value] of [['status','draft'],['status','cancelled'],['status','waived'],['removed_at','2026-10-24'],['issued_at',null],['issued_at','2026-10-26'],['invoice_date','2026-11-01']]){
  const original=baselineRows.rent_bills.find(r=>r.id===id(201))[column];
  await db.query(`update rent_bills set ${column}=$1 where id=$2`,[value,id(201)]);
  try{assert.equal((await rpc('dekez_report_due_snapshot',[id(1),'2026-10-25T12:00:00Z'])).overdue,100,column+' '+value);}
  finally{await db.query(`update rent_bills set ${column}=$1 where id=$2`,[original,id(201)]);}
 }
 await db.query("update rent_bills set status='paid',paid_amount=500 where id=$1",[id(201)]);
 try{assert.equal((await rpc('dekez_report_due_snapshot',[id(1),'2026-10-25T12:00:00Z'])).overdue,150);}
 finally{await db.query("update rent_bills set status='partially_paid',paid_amount=100 where id=$1",[id(201)]);}
 assert.deepEqual(await captureRows(),baselineRows);
});
