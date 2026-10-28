// Synthetic RPCs and transport only; no production services or network access.
const test = require('node:test'), assert = require('node:assert/strict');
const loader = require('./marketplace-component-loader.cjs');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-11-15T01:00:00Z'), day = '2026-11-15', fingerprint = 'a'.repeat(32);
const keys = ['DEKEZ_REPORT_COMPANY_ID', 'WHAPI_TOKEN', 'DEKEZ_COLLECTION_POLICY_ENABLED', 'DEKEZ_COLLECTION_SEND_ENABLED', 'DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED'];
let saved, originalFetch, calls, sends, previews, options, clock, signals, previewDeadlines;
const realNow=Date.now;
const budgeting=loader({'server-only':{},'@/lib/supabase/admin':{}})('lib/rental-collection/service.ts');
const currentItem = () => ({company_id:id(1),report_date:day,key:id(4),tenant_id:id(4),name:'Synthetic Contact',phone:'60191111111',recipient_source:'tenant_portal_login',
  outstanding:300,collectible_outstanding:300,exceptions:[],invoices:[{id:id(100),property:'Synthetic Property',property_code:'SYN',room:'D1',outstanding:300,paid_amount:200,verified_paid:200,collectible:true,exceptions:[]}]});
const failure = () => ({attempt_id:id(99),company_id:id(1),tenant_id:id(4),state:'failed',confirmed_failure:true,confirmation:'provider_delivery_receipt',failure_code:'delivery_failed',provider_message_id:'synthetic-original',resolved_at:null});
const authorization = () => ({verified:true,company_id:id(1),recipient:'60188702371',management_profile_id:id(3),approved_management_account:true,active_company_membership:true,
  rent_due_tracker_manage:true,whatsapp_ownership_verified:true,whatsapp_consent:'opted_in'});
const evidencePage = () => ({report_date:day,fingerprint,recipient_authorization:authorization(),items:[{key:'attempt:'+id(99),kind:'attempt',data:failure()}],next_cursor:null,total:1,daily_reservation:'not_reserved'});
const enable = () => Object.assign(process.env,{DEKEZ_REPORT_COMPANY_ID:id(1),WHAPI_TOKEN:'synthetic-only',DEKEZ_COLLECTION_POLICY_ENABLED:'true',DEKEZ_COLLECTION_SEND_ENABLED:'true',DEKEZ_COLLECTION_FAILURE_REPORT_ENABLED:'true'});
test.beforeEach(() => {
  saved = Object.fromEntries(keys.map(key=>[key,process.env[key]]));for(const key of keys)delete process.env[key];
  calls=[];sends=[];previews=[];signals=[];previewDeadlines=[];options={};clock=1_000_000;Date.now=()=>clock;originalFetch=global.fetch;global.fetch=()=>{throw Error('Network forbidden');};
});
test.afterEach(()=>{for(const key of keys){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}global.fetch=originalFetch;Date.now=realNow;});
function service() {
  return loader({'server-only':{},'@/lib/supabase/admin':{createAdminClient:()=>({rpc:(name,args)=>({abortSignal:async signal=>{
    signals.push(signal);calls.push({name,args});
    if(options.rpc)return options.rpc(name,args,calls.filter(c=>c.name===name).length);
    return {error:null,data:name==='dekez_collection_failure_evidence'?evidencePage():name==='dekez_collection_failure_claim'?{claimed:true,attempt_id:id(101),recipient:'60188702371',body:args.p_body}:null};
  }})})},'./service':{...budgeting,collectionPreview:async(at,after,limit,deadline)=>{
    previewDeadlines.push(deadline);previews.push({at,after,limit});return options.preview?options.preview(at,after,limit):{company_id:id(1),report_date:day,items:[currentItem()],next_cursor:null};
  }},'@/lib/management-report/whapi':{sendWhapiReport:async(...args)=>{sends.push(args);return options.outcome??{state:'accepted',providerId:'synthetic-digest',httpStatus:200,errorCode:null};}}})('lib/rental-collection/failure-service.ts');
}
const standardRpc=(name,args)=>({error:null,data:name==='dekez_collection_failure_evidence'?evidencePage():name==='dekez_collection_failure_claim'?{claimed:true,attempt_id:id(101),recipient:'60188702371',body:args.p_body}:null});

test('digest defaults disabled with zero RPC or outbound calls',async()=>{
  assert.equal((await service().sendCollectionFailureDigest(now)).state,'disabled');assert.deepEqual(calls,[]);assert.deepEqual(sends,[]);
});
test('each required switch, company and provider credential is fail-closed',async()=>{
  for(const key of keys){enable();delete process.env[key];assert.equal((await service().sendCollectionFailureDigest(now)).state,'disabled');}
  assert.equal(calls.length,0);assert.equal(sends.length,0);
});
test('no report sends outside the Malaysia9AM window',async()=>{
  enable();assert.equal((await service().sendCollectionFailureDigest(new Date('2026-11-15T00:59:59Z'))).state,'outside_window');
  assert.equal((await service().sendCollectionFailureDigest(new Date('2026-11-15T02:00:00Z'))).state,'outside_window');assert.equal(calls.length,0);
});
test('read-only preview uses bounded scoped RPCs and exact current balances without reserving or sending',async()=>{
  process.env.DEKEZ_REPORT_COMPANY_ID=id(1);const result=await service().collectionFailurePreview(now);
  assert.equal(result.allHistoryLoaded,true);assert.match(result.body,/Synthetic Contact/);assert.match(result.body,/RM 300.00/);
  assert.equal(result.canSend,false);assert.equal(sends.length,0);
  assert.deepEqual(calls.map(call=>call.name),['dekez_collection_failure_evidence','dekez_collection_failure_evidence']);
  for(const call of calls)assert.deepEqual(call.args,{p_company:id(1),p_after:null,p_limit:100});
  assert.deepEqual(previews,[{at:now,after:null,limit:100}]);
});
test('complete synthetic digest reserves once, validates body/recipient and records the provider outcome',async()=>{
  enable();assert.equal((await service().sendCollectionFailureDigest(now)).state,'accepted');
  assert.equal(sends.length,1);assert.equal(sends[0][1],'60188702371');
  const claim=calls.find(call=>call.name==='dekez_collection_failure_claim');
  assert.equal(claim.args.p_company,id(1));assert.equal(claim.args.p_fingerprint,fingerprint);
  assert.deepEqual(claim.args.p_snapshot,{company_id:id(1),report_date:day,recipient:'60188702371',all_history_loaded:true,contains_personal_details:true});
  assert.equal(sends[0][2],claim.args.p_body);
  assert.deepEqual(calls.at(-1),{name:'dekez_collection_failure_finish',args:{p_attempt:id(101),p_state:'accepted',p_provider_id:'synthetic-digest',p_http_status:200,p_error:null}});
});

test('shared request with insufficient preview and finalization budget stops before any RPC or reservation',async()=>{
  enable();assert.equal((await service().sendCollectionFailureDigest(now,clock+169_999)).state,'budget_review_required');
  assert.deepEqual(calls,[]);assert.deepEqual(previews,[]);assert.deepEqual(sends,[]);
});

test('digest uses the supplied deadline and never renews it after tenant work',async()=>{
  enable();const deadline=clock+180_000;const result=await service().sendCollectionFailureDigest(now,deadline);
  assert.equal(result.state,'accepted');assert.deepEqual(previewDeadlines,[1_090_000]);
  assert.ok(signals.every(signal=>signal instanceof AbortSignal&&!signal.aborted));
});

test('time advancing during current-source pagination withholds incomplete evidence before claim',async()=>{
  enable();options.preview=()=>{clock+=61_000;return {report_date:day,items:[currentItem()],next_cursor:'next'};};
  const result=await service().sendCollectionFailureDigest(now,1_180_000);
  assert.equal(result.state,'budget_review_required');assert.equal(sends.length,0);
  assert.equal(calls.some(call=>call.name==='dekez_collection_failure_claim'),false);assert.equal(previews.length,1);
});

test('time advancing after final evidence read is checked again before the digest claim',async()=>{
  enable();options.rpc=(name,args,count)=>{
    if(name==='dekez_collection_failure_evidence'&&count===2)clock+=110_001;
    return standardRpc(name,args);
  };
  assert.equal((await service().sendCollectionFailureDigest(now,1_180_000)).state,'budget_review_required');
  assert.equal(calls.some(call=>call.name==='dekez_collection_failure_claim'),false);assert.equal(sends.length,0);
});

test('unexpectedly late digest claim is retained as uncertain without sending or retrying',async()=>{
  enable();options.rpc=(name,args)=>{if(name==='dekez_collection_failure_claim')clock+=130_001;return standardRpc(name,args);};
  assert.equal((await service().sendCollectionFailureDigest(now,1_180_000)).state,'budget_review_required');
  assert.equal(sends.length,0);assert.equal(calls.filter(call=>call.name==='dekez_collection_failure_claim').length,1);
  assert.deepEqual(calls.at(-1),{name:'dekez_collection_failure_finish',args:{p_attempt:id(101),p_state:'uncertain',p_provider_id:null,p_http_status:null,p_error:'worker_interrupted'}});
});

test('expired read-only preview refuses a database call, rather than showing incomplete roster as complete',async()=>{
  process.env.DEKEZ_REPORT_COMPANY_ID=id(1);
  await assert.rejects(()=>service().collectionFailurePreview(now,true,clock-1),/budget requires review/);
  assert.equal(calls.length,0);assert.equal(sends.length,0);
});
test('duplicate, stale-source, unfinished run and recipient holds cannot reach transport',async()=>{
  enable();for(const state of ['already_reserved','source_changed','daily_review_incomplete','withheld']){
    options.rpc=(name,args)=>name==='dekez_collection_failure_claim'?{data:{claimed:false,state},error:null}:standardRpc(name,args);
    assert.equal((await service().sendCollectionFailureDigest(now)).state,state);
  }assert.equal(sends.length,0);assert.equal(calls.some(call=>call.name==='dekez_collection_failure_finish'),false);
});
test('missing or failed reservation throws a safe error before any transport',async()=>{
  enable();for(const error of [null,Error('private SQL detail')]){
    options.rpc=(name,args)=>name==='dekez_collection_failure_claim'?{data:null,error}:standardRpc(name,args);
    await assert.rejects(()=>service().sendCollectionFailureDigest(now),/^Error: Daily follow-up report reservation failed. Do not retry without review\.$/);
  }assert.equal(sends.length,0);
});
test('recipient or body changed by reservation response is retained as uncertain, never sent',async()=>{
  enable();for(const changes of [{recipient:'60198894911'},{body:'different content'}]){
    options.rpc=(name,args)=>name==='dekez_collection_failure_claim'?{data:{claimed:true,attempt_id:id(101),recipient:'60188702371',body:args.p_body,...changes},error:null}:standardRpc(name,args);
    assert.equal((await service().sendCollectionFailureDigest(now)).state,'recipient_review_required');
    assert.deepEqual(calls.at(-1).args,{p_attempt:id(101),p_state:'uncertain',p_provider_id:null,p_http_status:null,p_error:'worker_interrupted'});
  }assert.equal(sends.length,0);
});
test('uncertain or rejected delivery makes one attempt without retries',async()=>{
  enable();for(const state of ['uncertain','rejected']){
    sends=[];options.outcome={state,providerId:null,httpStatus:state==='rejected'?429:null,errorCode:state==='rejected'?'provider_rejected':'delivery_uncertain'};
    assert.equal((await service().sendCollectionFailureDigest(now)).state,state);assert.equal(sends.length,1);
  }
});
test('lost provider finalization reports uncertainty and does not resend',async()=>{
  enable();options.rpc=(name,args)=>name==='dekez_collection_failure_finish'?{data:null,error:Error('private error')}:standardRpc(name,args);
  assert.equal((await service().sendCollectionFailureDigest(now)).state,'uncertain');assert.equal(sends.length,1);
});
test('changing evidence fingerprint during pagination or final recheck prevents reservation',async()=>{
  enable();options.rpc=(name,args,count)=>name==='dekez_collection_failure_evidence'?{error:null,data:{...evidencePage(),fingerprint:count>1?'b'.repeat(32):fingerprint}}:standardRpc(name,args);
  assert.equal((await service().sendCollectionFailureDigest(now)).state,'incomplete_evidence');assert.equal(sends.length,0);
  assert.equal(calls.some(call=>call.name==='dekez_collection_failure_claim'),false);
});
test('incomplete evidence totals, unknown kinds and mismatched reporting date do not silently omit records',async()=>{
  enable();for(const change of [{total:2},{items:[{key:'unexpected',kind:'unknown',data:{}}]}]){
    options.rpc=(name,args)=>name==='dekez_collection_failure_evidence'?{error:null,data:{...evidencePage(),...change}}:standardRpc(name,args);
    assert.equal((await service().sendCollectionFailureDigest(now)).state,'incomplete_evidence');
  }
  options.rpc=undefined;options.preview=()=>({report_date:'2026-11-14',items:[currentItem()],next_cursor:null});
  assert.equal((await service().sendCollectionFailureDigest(now)).state,'incomplete_evidence');assert.equal(sends.length,0);
});
test('repeated current/evidence cursors stop safely instead of looping or sending a partial roster',async()=>{
  enable();options.preview=()=>({report_date:day,items:[currentItem()],next_cursor:'same'});
  assert.equal((await service().sendCollectionFailureDigest(now)).state,'incomplete_evidence');assert.equal(previews.length,2);
  options.preview=undefined;
  options.rpc=(name,args)=>name==='dekez_collection_failure_evidence'?{error:null,data:{...evidencePage(),next_cursor:'same',total:100}}:standardRpc(name,args);
  assert.equal((await service().sendCollectionFailureDigest(now)).state,'incomplete_evidence');assert.equal(sends.length,0);
});
test('bounded pagination keeps every historical case and current tenant exactly once',async()=>{
  enable();const first={...evidencePage(),next_cursor:'attempt-next',total:2};
  const second={...evidencePage(),items:[{key:'case:old',kind:'case',data:{case_id:'old',company_id:id(1),tenant_id:id(4),tenant_key:id(4),category:'communications_hold',reason_code:'opted_out',resolved_at:null}}],total:2};
  options.rpc=(name,args)=>name==='dekez_collection_failure_evidence'?{error:null,data:args.p_after===null?first:second}:standardRpc(name,args);
  const result=await service().collectionFailurePreview(now);assert.equal(result.allHistoryLoaded,true);assert.equal(result.followUpTenants,1);assert.match(result.body,/RM 300.00/);
  assert.equal(calls.filter(call=>call.name==='dekez_collection_failure_evidence').length,3);assert.equal(sends.length,0);
});
test('no unresolved cases means no unnecessary daily alert',async()=>{
  enable();options.rpc=(name,args)=>name==='dekez_collection_failure_evidence'?{error:null,data:{...evidencePage(),items:[],total:0}}:standardRpc(name,args);
  assert.equal((await service().sendCollectionFailureDigest(now)).state,'no_followups');assert.equal(sends.length,0);assert.equal(calls.some(call=>call.name==='dekez_collection_failure_claim'),false);
});
test('latest recipient authorization overrides earlier pages; Admin portal access never leaks into message body',async()=>{
  process.env.DEKEZ_REPORT_COMPANY_ID=id(1);
  options.rpc=(name,args,count)=>name==='dekez_collection_failure_evidence'?{error:null,data:{...evidencePage(),recipient_authorization:count>1?null:authorization()}}:standardRpc(name,args);
  const result=await service().collectionFailurePreview(now,true);
  assert.equal(result.containsPersonalDetails,false);assert.match(result.fullPortalReport,/Synthetic Contact/);
  assert.doesNotMatch(result.body,/Synthetic Contact|60191111111|RM 300/);assert.equal(sends.length,0);
});
test('missing scope or malformed evidence produces safe errors without database details',async()=>{
  await assert.rejects(()=>service().collectionFailurePreview(now),/company is not configured/);assert.equal(calls.length,0);
  process.env.DEKEZ_REPORT_COMPANY_ID=id(1);
  for(const result of [{error:Error('private SQL'),data:null},{error:null,data:{items:'wrong',fingerprint}},{error:null,data:{items:[]}}]){
    options.rpc=()=>result;await assert.rejects(()=>service().collectionFailurePreview(now),/^Error: Reminder follow-up evidence is unavailable\.$/);
  }assert.equal(sends.length,0);
});

test('digest monitoring metadata is exposed only to the authorized portal preview, never the WhatsApp body',async()=>{
 process.env.DEKEZ_REPORT_COMPANY_ID=id(1);
 const digest={report_date:day,state:'accepted',delivery_state:'failed',error_code:null,updated_at:null,needs_admin_review:true};
 options.rpc=(name,args)=>name==='dekez_collection_failure_evidence'?{error:null,data:{...evidencePage(),digest_status:digest,digest_alerts:[digest],digest_alert_count:1}}:standardRpc(name,args);
 const portal=await service().collectionFailurePreview(now,true);
 assert.equal(portal.digestStatusAvailable,true);assert.deepEqual(portal.digestStatus,digest);assert.equal(portal.digestAlertCount,1);assert.deepEqual(portal.digestAlerts,[digest]);
 const outgoing=await service().collectionFailurePreview(now,false);
 assert.equal(outgoing.digestStatus,null);assert.equal(outgoing.digestStatusAvailable,false);assert.deepEqual(outgoing.digestAlerts,[]);assert.equal(outgoing.digestAlertCount,0);
 assert.equal(portal.body,outgoing.body);assert.equal(sends.length,0);
});
