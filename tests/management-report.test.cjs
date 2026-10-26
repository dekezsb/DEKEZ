const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const loader=require('./marketplace-component-loader.cjs');
const load=loader({'server-only':{}}),model=load('lib/management-report/model.ts'),config=load('lib/management-report/config.ts'),whapi=load('lib/management-report/whapi.ts');
const keys=['WHAPI_TOKEN','WHAPI_REPORT_TO','DEKEZ_REPORT_COMPANY_ID','DEKEZ_REPORT_SEND_ENABLED','DEKEZ_REPORT_TEST_ENABLED','DEKEZ_REPORT_SCHEDULE_ENABLED','CRON_SECRET'];
const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));const originalFetch=global.fetch;
let calls=[],response,db,id,dbCalls=[];
const now=new Date('2026-10-25T12:00:00Z');
function enable(){Object.assign(process.env,{WHAPI_TOKEN:'synthetic-only-token',WHAPI_REPORT_TO:'60198894911',DEKEZ_REPORT_COMPANY_ID:id(1),DEKEZ_REPORT_SEND_ENABLED:'true',DEKEZ_REPORT_TEST_ENABLED:'true',DEKEZ_REPORT_SCHEDULE_ENABLED:'true'});}
const fakeClient={rpc:async(name,args)=>{
 dbCalls.push(name);const values=Object.values(args),placeholders=values.map((_,i)=>'$'+(i+1)).join(',');
 try{return {data:(await db.rpcQuery(`select public.${name}(${placeholders}) result`,values)).rows[0].result,error:null};}
 catch(error){return {data:null,error};}
}};
const service=loader({'server-only':{},'@/lib/supabase/admin':{createAdminClient:()=>fakeClient}})('lib/management-report/service.ts');
test.before(async()=>{db=await require('./fixtures/management-report.cjs')({recipientMigration:true});id=db.id;});
test.beforeEach(async()=>{
 calls=[];dbCalls=[];for(const k of keys)delete process.env[k];
 response=()=>Response.json({sent:true,message:{id:'fixture-id',status:'pending'}});
 global.fetch=async(url,options)=>{calls.push({url,options});return response();};
 await db.exec('truncate dekez_reports_private.test_authorizations,dekez_reports_private.delivery_attempts,dekez_reports_private.report_runs');
});
test.after(async()=>{global.fetch=originalFetch;for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}await db?.close();});
test('all send switches default off; only the approved recipient is configured',()=>{
 const initial=config.reportConfig();assert.equal(initial.recipient,'60198894911');assert.equal(initial.configured,false);
 assert.equal(initial.sendEnabled,false);assert.equal(initial.testEnabled,false);assert.equal(initial.scheduleEnabled,false);
 enable();assert.equal(config.reportConfig().configured,true);
 for(const value of ['60168173911','60123456789','+60198894911','123','60198894911@evil','https://evil']){
  process.env.WHAPI_REPORT_TO=value;assert.equal(config.reportConfig().recipient,value);assert.equal(config.reportConfig().configured,false);
 }
});

test('old or arbitrary configured recipients cannot send ordinary daily or test reports even with all gates enabled',async()=>{
 for(const recipient of ['60168173911','60123456789']){
  enable();process.env.WHAPI_REPORT_TO=recipient;
  assert.equal((await service.deliverManagementReport('daily',null,now)).state,'disabled');
  assert.equal((await service.deliverManagementReport('test',id(3),now)).state,'disabled');
 }
 assert.deepEqual(calls,[]);assert.deepEqual(dbCalls,[]);
});
test('Malaysia calendar and daily time window handle year/month/leap-day boundaries',()=>{
 for(const [iso,date] of [['2026-12-31T16:00:00Z','2027-01-01'],['2028-02-29T15:59:59Z','2028-02-29'],['2028-02-29T16:00:00Z','2028-03-01']])assert.equal(model.malaysiaReportDate(new Date(iso)),date);
 assert.equal(model.isDailyReportTime(now),true);assert.equal(model.isDailyReportTime(new Date('2026-10-25T11:59:59Z')),false);assert.equal(model.isDailyReportTime(new Date('2026-10-25T13:00:00Z')),false);
});
test('disabled/unconfigured worker makes zero database and network calls',async()=>{
 assert.equal((await service.deliverManagementReport('daily',null,now)).state,'disabled');enable();process.env.DEKEZ_REPORT_SEND_ENABLED='false';
 assert.equal((await service.deliverManagementReport('test',id(3),now)).state,'disabled');assert.deepEqual(calls,[]);assert.deepEqual(dbCalls,[]);
});
test('scheduled and test gates are independent; scheduling never catches up outside 20:00 hour',async()=>{
 enable();process.env.DEKEZ_REPORT_SCHEDULE_ENABLED='false';assert.equal((await service.deliverManagementReport('daily',null,now)).state,'disabled');
 process.env.DEKEZ_REPORT_SCHEDULE_ENABLED='true';process.env.DEKEZ_REPORT_TEST_ENABLED='false';assert.equal((await service.deliverManagementReport('test',id(3),now)).state,'disabled');
 assert.equal((await service.deliverManagementReport('daily',null,new Date('2026-10-25T15:00Z'))).state,'outside_window');assert.equal(calls.length,0);
});
test('read-only preview has real aggregate fixture totals, no PII and no delivery reservation',async()=>{
 enable();const s=await service.reportPreview(now),body=model.formatReport(s,'test');
 assert.match(body,/RM250.00/);assert.match(body,/RM450.00/);assert.match(body,/20:00 MYT/);assert.doesNotMatch(body,/00000000|synthetic-only-token|60168173911|60198894911/);
 assert.equal(calls.length,0);assert.deepEqual(dbCalls,['dekez_management_report_snapshot']);
 assert.equal((await db.query('select count(*)::int n from dekez_reports_private.report_runs')).rows[0].n,0);
 s.overdue=null;assert.match(model.formatReport(s,'test'),/Overdue invoice balance\*: Unavailable/);
});
test('real service -> real SQL -> mocked Whapi approved-recipient send -> accepted log; duplicate invocation never sends twice',async()=>{
 enable();assert.equal((await service.deliverManagementReport('test',id(3),now)).state,'accepted');
 assert.equal((await service.deliverManagementReport('test',id(3),now)).duplicate,true);assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://gate.whapi.cloud/messages/text');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Authorization,'Bearer synthetic-only-token');
 const body=JSON.parse(calls[0].options.body);assert.equal(body.to,'60198894911');assert.equal(body.no_link_preview,true);assert.match(body.body,/\[TEST\]/);
 const log=(await db.query('select * from dekez_reports_private.delivery_attempts')).rows[0];assert.equal(log.state,'accepted');assert.equal(log.provider_message_id,'fixture-id');
});
test('daily schedule service still claims and finalizes through functions with no direct table grants',async()=>{
 enable();assert.equal((await service.deliverManagementReport('daily',null,now)).state,'accepted');
 assert.equal((await service.deliverManagementReport('daily',null,now)).duplicate,true);assert.equal(calls.length,1);
 assert.doesNotMatch(JSON.parse(calls[0].options.body).body,/\[TEST\]/);
 assert.equal((await db.query('select state from dekez_reports_private.report_runs')).rows[0].state,'accepted');
});
test('timeouts after possible acceptance and 500/malformed success block retries',async()=>{
 enable();for(const responseFactory of [()=>{throw Error('secret provider network failure');},()=>new Response('private provider error',{status:500}),()=>Response.json({sent:true}),()=>Response.json({sent:false})]){
  await db.exec('truncate dekez_reports_private.test_authorizations,dekez_reports_private.delivery_attempts,dekez_reports_private.report_runs');calls=[];response=responseFactory;
  assert.equal((await service.deliverManagementReport('daily',null,now)).state,'uncertain');
  assert.equal((await service.deliverManagementReport('daily',null,now)).duplicate,true);assert.equal(calls.length,1);
 }
});
test('documented rejection returns sanitized error with no response text or token persisted',async()=>{
 enable();response=()=>new Response('SECRET SQL TOKEN raw provider body',{status:401});assert.equal((await service.deliverManagementReport('test',id(3),now)).state,'rejected');
 const rows=(await db.query('select * from dekez_reports_private.delivery_attempts')).rows;assert.equal(rows[0].error_code,'provider_rejected');assert.doesNotMatch(JSON.stringify(rows),/SECRET|TOKEN|synthetic/);
});
test('failure saving provider result returns uncertain; reservation still prevents another send',async()=>{
 enable();const api=loader({'server-only':{},'@/lib/supabase/admin':{createAdminClient:()=>({rpc:(name,args)=>name.endsWith('_finish')?Promise.resolve({error:Error('private database error')}):fakeClient.rpc(name,args)})}})('lib/management-report/service.ts');
 assert.equal((await api.deliverManagementReport('daily',null,now)).state,'uncertain');assert.equal((await api.deliverManagementReport('daily',null,now)).duplicate,true);assert.equal(calls.length,1);
});
test('missing company or database failure fails closed before sending',async()=>{
 enable();process.env.DEKEZ_REPORT_COMPANY_ID=id(999);await assert.rejects(service.deliverManagementReport('daily',null,now),/unavailable/);assert.equal(calls.length,0);
});
test('Whapi transport rejects malformed recipients and empty body without network',async()=>{
 await assert.rejects(whapi.sendWhapiReport('x','https://evil','body'));await assert.rejects(whapi.sendWhapiReport('x','60198894911',''));assert.equal(calls.length,0);
});
test('cron fails closed on missing/wrong secret; authenticated caller cannot override report parameters',async()=>{
 let received=[];const api=loader({'@/lib/management-report/service':{deliverManagementReport:async(...args)=>{received.push(args);return {state:'disabled'};}}})('app/api/management-report/route.ts');
 const req=auth=>new Request('https://fixture.invalid/api/management-report?recipient=evil&company=evil&date=2000-01-01',{headers:{authorization:auth}});
 assert.equal((await api.GET(req('Bearer undefined'))).status,401);process.env.CRON_SECRET='fixture-secret';assert.equal((await api.GET(req('Bearer wrong'))).status,401);assert.equal(received.length,0);
 const r=await api.GET(req('Bearer fixture-secret'));assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'private, no-store');assert.deepEqual(received,[['daily']]);
});
test('manual action denies non-Admin; server chooses actor and test mode, ignores supplied fields',async()=>{
 let actor=null,received=[];const action=loader({'@/lib/management-report/single-use-test':{},'@/lib/management-report/authorization':{reportAdministrator:async()=>actor},'@/lib/management-report/service':{deliverManagementReport:async(...args)=>{received.push(args);return {state:'disabled'};}}})('app/admin-setup/management-report/actions.ts');
 assert.match(await action.sendTestReport(),/Not authorized/);assert.equal(received.length,0);actor=id(3);assert.match(await action.sendTestReport({recipient:'evil',company:'evil'}),/disabled/);assert.deepEqual(received,[['test',id(3)]]);
});
test('authorization verifies fresh identity/profile; never trusts role metadata alone',async()=>{
 let context=null,profile={role:'super_admin',registration_status:'approved'},authUser={id:id(3)};
 const auth=loader({'server-only':{},'@/lib/auth/session':{getOptionalUserAccess:async()=>context},'@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>({data:{user:authUser}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:profile})})})})})}})('lib/management-report/authorization.ts');
 assert.equal(await auth.reportAdministrator(),null);
 for(const role of ['tenant','client_owner','contractor_preview','admin','owner']){context={role,access:{admin_setup:'manage'},user:{id:id(3)}};assert.equal(await auth.reportAdministrator(),null);}
 context={role:'super_admin',access:{admin_setup:'manage'},user:{id:id(3)}};assert.equal(await auth.reportAdministrator(),id(3));
 profile=null;assert.equal(await auth.reportAdministrator(),null);profile={role:'super_admin',registration_status:'rejected'};assert.equal(await auth.reportAdministrator(),null);
 profile={role:'super_admin',registration_status:'approved'};authUser=null;assert.equal(await auth.reportAdministrator(),null);
});
test('production migration version is reconciled exactly once without changing approved SQL',()=>{
 const names=fs.readdirSync('supabase/migrations').filter(name=>name.endsWith('_whapi_management_reports.sql'));
 assert.deepEqual(names,['20261025083739_whapi_management_reports.sql']);
 const sql=fs.readFileSync('supabase/migrations/'+names[0],'utf8').replace(/\r\n/g,'\n');
 assert.equal(require('node:crypto').createHash('sha256').update(sql).digest('hex'),'3dd63a191dc0a0901dde637c3b8e4a51beccfc5a2658a184d1466ea9356c0b75');
});

test('schedule remains pending, existing cron definitions preserved, sources contain no Meta/financial write paths',()=>{
 const vercel=JSON.parse(fs.readFileSync('vercel.json','utf8')),crons=vercel.crons;
 assert.deepEqual(crons,[
  {path:'/api/dekez-chat-assistant',schedule:'* * * * *'},
  {path:'/api/dekez-chat-reminders',schedule:'7,17,27,37,47,57 * * * *'},
  {path:'/api/rental-billing',schedule:'5 16 * * *'},
  {path:'/api/rent-reminders',schedule:'0 * * * *'},
  {path:'/api/tenancy-renewals',schedule:'0 7 * * *'},
  {path:'/api/document-archive',schedule:'*/10 * * * *'}
 ]);
 assert.deepEqual(vercel.git.deploymentEnabled,{'feature/whapi-report-review-20261025':false,'security/dependency-remediation-20261025':false,'feature/whapi-single-use-test-20261025':false});
 assert.deepEqual(JSON.parse(fs.readFileSync('config/management-report-cron.pending.json','utf8')),{path:'/api/management-report',schedule:'0 12 * * *'});
 const sql=fs.readFileSync('supabase/migrations/20261025083739_whapi_management_reports.sql','utf8');assert.doesNotMatch(sql,/\b(update|insert into|delete from|alter table) public\.(payments|rent_bills|tenancies|whatsapp_)/i);
});
