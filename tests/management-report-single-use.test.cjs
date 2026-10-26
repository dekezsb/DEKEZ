// Real application service + SQL in disposable PostgreSQL/PGlite; mocked HTTP only.
// Concurrent requests share one serialized PGlite connection, while provider IO
// overlaps them. Native multi-session PostgreSQL lock contention is not simulated.
const test=require('node:test'),assert=require('node:assert/strict');
const loader=require('./marketplace-component-loader.cjs');
const keys=['WHAPI_TOKEN','WHAPI_REPORT_TO','DEKEZ_REPORT_COMPANY_ID','DEKEZ_REPORT_SEND_ENABLED','DEKEZ_REPORT_TEST_ENABLED','DEKEZ_REPORT_SCHEDULE_ENABLED'];
const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]])),originalFetch=global.fetch;
let db,id,httpCalls,rpcCalls,response,failFinish=false,loseConsumeResponse=false;
const client={rpc:async(name,args)=>{
 rpcCalls.push(name);
 if(failFinish&&name==='dekez_management_report_finish')return {error:Error('synthetic finish failure')};
 try{
  const values=Object.values(args),params=values.map((_,i)=>'$'+(i+1)).join(',');
  const data=(await db.rpcQuery(`select public.${name}(${params}) result`,values)).rows[0].result;
  if(loseConsumeResponse&&name==='dekez_management_report_consume_test')return {error:Error('synthetic lost committed response')};
  return {data,error:null};
 }catch(error){return {error,data:null};}
}};
const load=loader({'server-only':{},'@/lib/supabase/admin':{createAdminClient:()=>client}});
const service=load('lib/management-report/single-use-test.ts'),ordinary=load('lib/management-report/service.ts'),config=load('lib/management-report/config.ts');
const counts=async()=>(await db.query(`select
 (select count(*)::int from dekez_reports_private.test_authorizations) approvals,
 (select count(*)::int from dekez_reports_private.report_runs) runs,
 (select count(*)::int from dekez_reports_private.delivery_attempts) attempts`)).rows[0];
function configure(){Object.assign(process.env,{WHAPI_TOKEN:'synthetic-only-token',WHAPI_REPORT_TO:'60198894911',DEKEZ_REPORT_COMPANY_ID:id(1),DEKEZ_REPORT_SEND_ENABLED:'false',DEKEZ_REPORT_TEST_ENABLED:'false',DEKEZ_REPORT_SCHEDULE_ENABLED:'false'});}
test.before(async()=>{db=await require('./fixtures/management-report.cjs')({singleUseMigration:true,recipientMigration:true});id=db.id;
 await db.query('insert into profiles values ($1,$2,$3)',[id(5),'super_admin','approved']);
});
test.beforeEach(async()=>{
 for(const key of keys)delete process.env[key];configure();httpCalls=[];rpcCalls=[];failFinish=false;loseConsumeResponse=false;
 await db.exec('truncate dekez_reports_private.test_authorizations,dekez_reports_private.delivery_attempts,dekez_reports_private.report_runs');
 await db.query("update profiles set role='super_admin',registration_status='approved' where id=$1",[id(3)]);
 response=()=>Response.json({sent:true,message:{id:'synthetic-one-time-id'}});
 global.fetch=async(url,options)=>{httpCalls.push({url,options});return response();};
});
test.after(async()=>{global.fetch=originalFetch;for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}await db?.close();});

test('all flags remain false; requesting approval never sends or reserves a delivery',async()=>{
 const grant=await service.requestTestAuthorization(id(3));assert.equal(grant.state,'ready');
 assert.equal(grant.recipient,'60198894911');assert.match(grant.body,/^\[TEST\]/);assert.ok(Date.parse(grant.expiresAt)>Date.now());
 assert.deepEqual(await counts(),{approvals:1,runs:0,attempts:0});assert.equal(httpCalls.length,0);
 const c=config.reportConfig();assert.equal(c.sendEnabled,false);assert.equal(c.testEnabled,false);assert.equal(c.scheduleEnabled,false);
 assert.equal((await ordinary.deliverManagementReport('daily')).state,'disabled');
 assert.equal((await ordinary.deliverManagementReport('test',id(3))).state,'disabled');
 assert.equal(httpCalls.length,0);
});

test('one approved test uses exact frozen preview and fixed approved recipient with durable logs',async()=>{
 const grant=await service.requestTestAuthorization(id(3));assert.equal(grant.state,'ready');
 // Later source activity must not silently replace the report the Admin approved.
 await db.query("insert into rooms values ($1,$2,'vacant')",[id(999),id(10)]);
 try{
  assert.equal((await service.executeAuthorizedTest(id(3),grant.authorizationId)).state,'accepted');
  assert.equal(httpCalls.length,1);const request=JSON.parse(httpCalls[0].options.body);
  assert.equal(request.to,'60198894911');assert.equal(request.body,grant.body);
  assert.equal(httpCalls[0].url,'https://gate.whapi.cloud/messages/text');
  const row=(await db.query('select state,provider_message_id,http_status from dekez_reports_private.delivery_attempts')).rows[0];
  assert.deepEqual(row,{state:'accepted',provider_message_id:'synthetic-one-time-id',http_status:200});
  assert.equal((await service.executeAuthorizedTest(id(3),grant.authorizationId)).state,'consumed');
  assert.equal((await service.requestTestAuthorization(id(3))).state,'duplicate');assert.equal(httpCalls.length,1);
 }finally{await db.query('delete from rooms where id=$1',[id(999)]);}
});

test('24 simultaneous execute requests for one approval result in one mocked HTTP send',async()=>{
 const grant=await service.requestTestAuthorization(id(3));
 response=async()=>{await new Promise(resolve=>setTimeout(resolve,30));return Response.json({sent:true,message:{id:'concurrent-once'}});};
 const results=await Promise.all(Array.from({length:24},()=>service.executeAuthorizedTest(id(3),grant.authorizationId)));
 assert.equal(results.filter(r=>r.state==='accepted').length,1);assert.equal(results.filter(r=>r.state==='consumed').length,23);
 assert.equal(httpCalls.length,1);assert.deepEqual(await counts(),{approvals:1,runs:1,attempts:1});
});

test('competing approvals and Admins share the same per-date test duplicate guard',async()=>{
 const grants=await Promise.all([service.requestTestAuthorization(id(3)),service.requestTestAuthorization(id(5))]);
 const results=await Promise.all(grants.map((g,i)=>service.executeAuthorizedTest(id(i===0?3:5),g.authorizationId)));
 assert.equal(results.filter(r=>r.state==='accepted').length,1);assert.equal(results.filter(r=>r.state==='duplicate').length,1);
 assert.equal(httpCalls.length,1);assert.deepEqual(await counts(),{approvals:2,runs:1,attempts:1});
});

test('wrong recipient, missing token, invalid ID and enabled schedule fail before database or HTTP calls',async()=>{
 for(const [key,value] of [['WHAPI_REPORT_TO','60168173911'],['WHAPI_REPORT_TO','60123456789'],['WHAPI_TOKEN',''],['DEKEZ_REPORT_COMPANY_ID','bad'],['DEKEZ_REPORT_SCHEDULE_ENABLED','true']]){
  configure();process.env[key]=value;
  assert.equal((await service.requestTestAuthorization(id(3))).state,'unavailable');
  assert.equal((await service.executeAuthorizedTest(id(3),id(100))).state,'unavailable');
 }
 configure();assert.equal((await service.executeAuthorizedTest(id(3),'bad')).state,'unavailable');
 assert.equal((await service.requestTestAuthorization('bad')).state,'unavailable');
 assert.deepEqual(rpcCalls,[]);assert.equal(httpCalls.length,0);
});

test('switching configuration back to the old number cannot consume or send an existing new-recipient authorization',async()=>{
 const grant=await service.requestTestAuthorization(id(3));const beforeCalls=rpcCalls.length;
 process.env.WHAPI_REPORT_TO='60168173911';
 assert.equal((await service.executeAuthorizedTest(id(3),grant.authorizationId)).state,'unavailable');
 assert.equal((await service.revokeTestAuthorization(id(3),grant.authorizationId)).state,'unavailable');
 assert.equal(rpcCalls.length,beforeCalls);assert.equal(httpCalls.length,0);
 assert.deepEqual(await counts(),{approvals:1,runs:0,attempts:0});
});

test('configured company changes invalidate approval rather than silently retargeting it',async()=>{
 const grant=await service.requestTestAuthorization(id(3));process.env.DEKEZ_REPORT_COMPANY_ID=id(2);
 assert.equal((await service.executeAuthorizedTest(id(3),grant.authorizationId)).state,'not_authorized');
 assert.equal(httpCalls.length,0);assert.equal((await counts()).attempts,0);
});

test('fresh database Admin status and original approving Admin are required at execution',async()=>{
 const grant=await service.requestTestAuthorization(id(3));
 assert.equal((await service.executeAuthorizedTest(id(5),grant.authorizationId)).state,'not_authorized');
 for(const status of ['pending','rejected']){
  await db.query('update profiles set registration_status=$1 where id=$2',[status,id(3)]);
  await assert.rejects(service.executeAuthorizedTest(id(3),grant.authorizationId),/Could not confirm/);
 }
 assert.equal(httpCalls.length,0);assert.equal((await counts()).attempts,0);
});

test('expired and explicitly revoked authorizations never send, including without provider token',async()=>{
 const expired=await service.requestTestAuthorization(id(3));
 // now() is transaction-stable: keep the expired fixture exactly five minutes long.
 const fixture=await db.query("update dekez_reports_private.test_authorizations set created_at=now()-interval '6 minutes',expires_at=now()-interval '1 minute' where id=$1 returning expires_at-created_at=interval '5 minutes' exact_duration",[expired.authorizationId]);
 assert.equal(fixture.rows[0].exact_duration,true);
 assert.equal((await service.executeAuthorizedTest(id(3),expired.authorizationId)).state,'expired');
 const revoked=await service.requestTestAuthorization(id(3));process.env.WHAPI_TOKEN='';
 assert.equal((await service.revokeTestAuthorization(id(3),revoked.authorizationId)).state,'revoked');configure();
 assert.equal((await service.executeAuthorizedTest(id(3),revoked.authorizationId)).state,'not_authorized');
 assert.equal(httpCalls.length,0);assert.equal((await counts()).attempts,0);
});

test('every uncertain provider outcome consumes approval permanently; no automatic or fresh-grant retry',async()=>{
 for(const factory of [()=>{throw Error('synthetic timeout after provider may accept');},()=>new Response('private failure',{status:500}),()=>Response.json({sent:true}),()=>new Response('invalid json')]){
  await db.exec('truncate dekez_reports_private.test_authorizations,dekez_reports_private.delivery_attempts,dekez_reports_private.report_runs');httpCalls=[];
  const grant=await service.requestTestAuthorization(id(3));response=factory;
  assert.equal((await service.executeAuthorizedTest(id(3),grant.authorizationId)).state,'uncertain');
  assert.equal((await service.executeAuthorizedTest(id(3),grant.authorizationId)).state,'consumed');
  assert.equal((await service.requestTestAuthorization(id(3))).state,'duplicate');assert.equal(httpCalls.length,1);
  assert.equal((await db.query('select state from dekez_reports_private.delivery_attempts')).rows[0].state,'uncertain');
 }
});

test('even definitive rejection does not allow another one-time test attempt that day',async()=>{
 const grant=await service.requestTestAuthorization(id(3));response=()=>new Response('secret provider text',{status:401});
 assert.equal((await service.executeAuthorizedTest(id(3),grant.authorizationId)).state,'rejected');
 assert.equal((await service.requestTestAuthorization(id(3))).state,'duplicate');assert.equal(httpCalls.length,1);
 const rows=(await db.query('select * from dekez_reports_private.delivery_attempts')).rows;
 assert.equal(rows[0].error_code,'provider_rejected');assert.doesNotMatch(JSON.stringify(rows),/secret provider|synthetic-only-token/);
});

test('lost consume response does not send, and committed reservation cannot be retried',async()=>{
 const grant=await service.requestTestAuthorization(id(3));loseConsumeResponse=true;
 await assert.rejects(service.executeAuthorizedTest(id(3),grant.authorizationId),/do not retry/);
 loseConsumeResponse=false;assert.equal((await service.executeAuthorizedTest(id(3),grant.authorizationId)).state,'consumed');
 assert.equal((await service.requestTestAuthorization(id(3))).state,'duplicate');assert.equal(httpCalls.length,0);
 assert.deepEqual(await counts(),{approvals:1,runs:1,attempts:1});
});

test('failed finish logging returns uncertain and still blocks duplicate delivery',async()=>{
 const grant=await service.requestTestAuthorization(id(3));failFinish=true;
 assert.equal((await service.executeAuthorizedTest(id(3),grant.authorizationId)).state,'uncertain');
 assert.equal((await service.executeAuthorizedTest(id(3),grant.authorizationId)).state,'consumed');
 assert.equal((await service.requestTestAuthorization(id(3))).state,'duplicate');assert.equal(httpCalls.length,1);
});
