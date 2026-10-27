const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const loader=require('./marketplace-component-loader.cjs');
const load=loader({'server-only':{}}),model=load('lib/rental-collection/model.ts'),config=load('lib/rental-collection/config.ts');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const now=new Date('2026-11-15T01:00:00Z');
function item(days=14,paid=200){return {company_id:id(1),report_date:'2026-11-15',key:id(4),tenant_id:id(4),name:'Synthetic tenant',phone:'60191111111',recipient_source:'tenant_portal_login',whatsapp_ownership_verified:true,delivery_blocks:[],stage:model.collectionStage(days,500-paid),days_overdue:days,outstanding:500-paid,partial_invoices:paid>0&&paid<500?1:0,
 invoices:[{id:id(100),tenancy_id:id(21),property_id:id(10),room_id:id(11),reference:'SYNTH-100',property:'Synthetic property',property_code:'TEST',room:'A1',due_date:'2026-11-01',days_overdue:days,base_amount:500,extra_amount:0,paid_amount:paid,verified_paid:paid,outstanding:500-paid,status:'unpaid',pending:[],exceptions:[]}],
 pending:[],pending_verification:false,exceptions:[],policy:{enabled:true,compliance_approved:true,consent:'opted_in',approved_recipient:'60191111111',opt_out_ready:true,hold:'none'},send_eligible:true,resolved:paid===500,fingerprint:'synthetic-fingerprint'};}
const keys=['DEKEZ_REPORT_COMPANY_ID','WHAPI_TOKEN','DEKEZ_COLLECTION_POLICY_ENABLED','DEKEZ_COLLECTION_SEND_ENABLED','CRON_SECRET'];
const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
let calls=[],sends=[],followups=[],signals=[],current,overrides={},clock,delivery={state:'accepted',providerId:'synthetic-id',httpStatus:200,errorCode:null};
const realNow=Date.now;
const client={rpc:(name,args)=>({abortSignal:async signal=>{signals.push(signal);calls.push({name,args});if(overrides[name])return overrides[name](args);return {data:
 name==='dekez_collection_scan'?{checked:1,report_date:'2026-11-15'}:
 name==='dekez_collection_begin_run'?{claimed:true,run_id:id(98),state:'running'}:
 name==='dekez_collection_preview'?{company_id:id(1),report_date:'2026-11-15',items:[current],next_cursor:null,summary:{}}:
 name==='dekez_collection_claim'?{claimed:true,attempt_id:id(99),recipient:current.phone,body:args.p_body}:null,error:null};}})};
const service=loader({'server-only':{},'@/lib/supabase/admin':{createAdminClient:()=>client},'node:timers/promises':{setTimeout:async ms=>{clock+=ms;}},'./failure-service':{sendCollectionFailureDigest:async(at,deadline)=>{followups.push({at,deadline});return {state:'disabled'};}},'@/lib/management-report/whapi':{sendWhapiReport:async(...args)=>{sends.push(args);return delivery;}}})('lib/rental-collection/service.ts');
const route=loader({'@/lib/rental-collection/service':{runRentalCollections:()=>service.runRentalCollections(now)}})('app/api/rental-collections/route.ts');
const enable=()=>Object.assign(process.env,{DEKEZ_REPORT_COMPANY_ID:id(1),WHAPI_TOKEN:'synthetic-only',DEKEZ_COLLECTION_POLICY_ENABLED:'true',DEKEZ_COLLECTION_SEND_ENABLED:'true'});
test.beforeEach(()=>{for(const k of keys)delete process.env[k];calls=[];sends=[];followups=[];signals=[];overrides={};clock=1_000_000;Date.now=()=>clock;current=item();delivery={state:'accepted',providerId:'synthetic-id',httpStatus:200,errorCode:null};});
test.afterEach(()=>{Date.now=realNow;});
test.after(()=>{for(const k of keys){if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}});
test('partial payments never reset original due date or daily stage; exact user example',()=>{
 assert.equal(model.originalOverdueDays('2026-11-01',new Date('2026-11-08T01:00Z')),7);
 assert.equal(model.originalOverdueDays('2026-11-01',now),14);
 for(const paid of [0,1,200,499.99])for(const [days,stage] of [[-7,'advance_7'],[0,'due_today'],[1,'overdue_1_6'],[6,'overdue_1_6'],[7,'day_7_review'],[8,'overdue_8_13'],[13,'overdue_8_13'],[14,'day_14_review'],[15,'overdue_15_plus'],[90,'overdue_15_plus']])assert.equal(model.collectionStage(days,500-paid),stage);
 assert.equal(model.collectionStage(14,0),'resolved');assert.equal(model.collectionStage(-3,300),'tracking');
 assert.equal(model.collectionStage(null,300),'exception');assert.equal(model.collectionStage(14,NaN),'exception');
});
test('Malaysia midnight/calendar/leap/year boundaries independent of payment timestamps',()=>{
 assert.equal(model.originalOverdueDays('2026-11-01',new Date('2026-11-07T15:59:59Z')),6);
 assert.equal(model.originalOverdueDays('2026-11-01',new Date('2026-11-07T16:00Z')),7);
 assert.equal(model.originalOverdueDays('2028-02-29',new Date('2028-03-01T01:00Z')),1);
 assert.equal(model.originalOverdueDays('2026-12-31',new Date('2027-01-01T01:00Z')),1);
 assert.throws(()=>model.originalOverdueDays('2026-02-30',now));
 assert.equal(model.isCollectionTime(now),true);assert.equal(model.isCollectionTime(new Date('2026-11-15T00:59:59Z')),false);assert.equal(model.isCollectionTime(new Date('2026-11-15T02:00Z')),false);
});
test('Day14 exact final-default content uses verified partial200 and remaining300, no extension or enforcement promise',()=>{
 const body=model.formatCollectionMessage(item());assert.match(body,/FINAL DEFAULT NOTICE/);assert.match(body,/now 14 days overdue/);
 assert.match(body,/Original Due Date: 1 November 2026/);assert.match(body,/Total Verified Payments: RM 200.00/);assert.match(body,/Remaining Outstanding Balance: RM 300.00/);
 assert.match(body,/Despite any partial payments/);assert.match(body,/subject to the signed tenancy agreement and applicable law/);
 assert.doesNotMatch(body,/automatically|weekly|door will|access deactivated|evicted/);
});
test('every day8–13 stays final warning and every15+ remains daily follow-up',()=>{
 for(let d=8;d<=13;d++)assert.match(model.formatCollectionMessage(item(d)),/FINAL-STAGE OVERDUE REMINDER/);
 for(const d of [15,16,21,90,365])assert.match(model.formatCollectionMessage(item(d)),/OUTSTANDING RENT FOLLOW-UP/);
 assert.match(model.formatCollectionMessage(item(7)),/urgent management review/);
});
test('full verified settlement no demand; pending neutral preview only, no false confirmation',()=>{
 assert.equal(model.formatCollectionMessage(item(14,500)),null);
 const pending=item();pending.pending_verification=true;const body=model.formatCollectionMessage(pending);
 assert.match(body,/verification is pending/);assert.doesNotMatch(body,/RM 300|FINAL DEFAULT|payment confirmed/);
 current.exceptions=['allocation_mismatch'];assert.equal(model.formatCollectionMessage(current),null);
});
test('consolidation preserves each invoice clock and excludes future invoices from demands',()=>{
 const row=item();row.invoices.push({...row.invoices[0],id:id(101),reference:'SYNTH-101',due_date:'2026-12-01',days_overdue:-16,paid_amount:0,verified_paid:0,outstanding:500});row.outstanding=800;
 const body=model.formatCollectionMessage(row);assert.match(body,/now 14 days/);assert.doesNotMatch(body,/1 December 2026|RM 800|RM 500/);assert.match(body,/Remaining Outstanding Balance: RM 300.00/);
 row.outstanding=300;assert.equal(model.formatCollectionMessage(row),null);
});
test('overlarge consolidated message is held, never truncated or split into duplicate demands',()=>{
 const row=item();row.invoices=Array.from({length:30},(_,i)=>({...row.invoices[0],id:id(i+100)}));row.outstanding=9000;assert.equal(model.formatCollectionMessage(row),null);
});
test('all new switches defaultfalse; disabledcron no database/network calls',async()=>{
 assert.equal(config.collectionConfig().policyEnabled,false);assert.equal(config.collectionConfig().sendEnabled,false);
 assert.equal((await service.runRentalCollections(now)).state,'disabled');assert.deepEqual(calls,[]);assert.deepEqual(sends,[]);assert.deepEqual(followups,[]);
});
test('daily scan covers every case before delivery; sendingdisabled still records internal review',async()=>{
 enable();process.env.DEKEZ_COLLECTION_SEND_ENABLED='false';assert.equal((await service.runRentalCollections(now)).state,'review_only');assert.deepEqual(calls.map(c=>c.name),['dekez_collection_scan']);assert.equal(sends.length,0);
});
test('outside9MYT no scan/send; scanfailure stops before transport',async()=>{
 enable();assert.equal((await service.runRentalCollections(new Date('2026-11-15T03:00Z'))).state,'outside_window');assert.equal(calls.length,0);
 overrides.dekez_collection_scan=()=>({data:null,error:Error('private detail')});await assert.rejects(()=>service.runRentalCollections(now),/review failed/);assert.equal(sends.length,0);
});
test('send pipeline scans, previews, atomicallyclaims, sendsonce and recordsprovider outcome',async()=>{
 enable();const r=await service.runRentalCollections(now);assert.equal(r.state,'complete');assert.equal(r.counts.accepted,1);assert.equal(sends.length,1);assert.equal(sends[0][1],current.phone);
 assert.deepEqual(calls.map(c=>c.name),['dekez_collection_scan','dekez_collection_begin_run','dekez_collection_preview','dekez_collection_claim','dekez_collection_finish','dekez_collection_finish_run']);
 assert.equal(calls[3].args.p_fingerprint,current.fingerprint);assert.equal(calls[4].args.p_provider_id,'synthetic-id');
 assert.deepEqual(calls[5].args,{p_run:id(98),p_state:'complete'});assert.deepEqual(followups,[{at:now,deadline:1_280_000}]);assert.equal(r.followUpReport.state,'disabled');
 assert.equal(signals.length,calls.length);assert.ok(signals.every(signal=>signal instanceof AbortSignal&&!signal.aborted));
});

test('scan time is charged to the one shared deadline before reserving a worker',async()=>{
 enable();overrides.dekez_collection_scan=()=>{clock+=110_001;return {data:{checked:1},error:null};};
 const result=await service.runRentalCollections(now);
 assert.equal(result.state,'incomplete');assert.equal(result.reason,'budget_review_required');
 assert.deepEqual(calls.map(call=>call.name),['dekez_collection_scan']);assert.equal(sends.length,0);
 assert.equal(followups[0].deadline,1_280_000);
});

test('slow worker reservation preserves finalization time without starting another source page',async()=>{
 enable();overrides.dekez_collection_begin_run=()=>{clock+=140_001;return {data:{claimed:true,run_id:id(98)},error:null};};
 const result=await service.runRentalCollections(now);
 assert.equal(result.state,'incomplete');assert.equal(result.reason,'budget_review_required');
 assert.deepEqual(calls.map(call=>call.name),['dekez_collection_scan','dekez_collection_begin_run','dekez_collection_finish_run']);
 assert.equal(calls.at(-1).args.p_state,'incomplete');assert.equal(sends.length,0);
});

test('time advancing during source preview prevents a late tenant claim and provider request',async()=>{
 enable();overrides.dekez_collection_preview=()=>{clock+=170_001;return {data:{company_id:id(1),report_date:'2026-11-15',items:[current],next_cursor:null},error:null};};
 const result=await service.runRentalCollections(now);
 assert.equal(result.state,'incomplete');assert.equal(result.reason,'budget_review_required');
 assert.equal(calls.some(call=>call.name==='dekez_collection_claim'),false);assert.equal(sends.length,0);
 assert.equal(calls.at(-1).args.p_state,'incomplete');assert.equal(followups[0].deadline,1_280_000);
});

test('pacing is charged before the next claim, without renewing the daily worker lease',async()=>{
 enable();overrides.dekez_collection_preview=()=>({data:{company_id:id(1),report_date:'2026-11-15',items:[current,current],next_cursor:null},error:null});
 overrides.dekez_collection_finish=()=>{clock=1_169_500;return {data:null,error:null};};
 const result=await service.runRentalCollections(now);
 assert.equal(result.state,'incomplete');assert.equal(result.reason,'budget_review_required');assert.equal(sends.length,1);
 assert.equal(calls.filter(call=>call.name==='dekez_collection_claim').length,1);
 assert.equal(calls.filter(call=>call.name==='dekez_collection_begin_run').length,1);
 assert.equal(calls.at(-1).args.p_state,'incomplete');assert.equal(followups[0].deadline,1_280_000);
});

test('unexpectedly late reservation is retained for review without making an HTTP send',async()=>{
 enable();overrides.dekez_collection_claim=args=>{clock+=200_001;return {data:{claimed:true,attempt_id:id(99),recipient:current.phone,body:args.p_body},error:null};};
 const result=await service.runRentalCollections(now);
 assert.equal(result.state,'incomplete');assert.equal(result.reason,'budget_review_required');assert.equal(sends.length,0);
 const finish=calls.find(call=>call.name==='dekez_collection_finish');assert.equal(finish.args.p_state,'uncertain');assert.equal(finish.args.p_error,'worker_interrupted');
 assert.equal(calls.at(-1).args.p_state,'incomplete');assert.equal(calls.filter(call=>call.name==='dekez_collection_claim').length,1);
});

test('expired database request budget receives an already-aborted signal',async()=>{
 let signal;await service.collectionRpc({abortSignal:async value=>{signal=value;return null;}},clock-1);
 assert.equal(signal.aborted,true);assert.equal(service.collectionHasBudget(NaN,1),false);
});

test('database request timeout never exceeds thirty seconds or the remaining shared budget',async()=>{
 const original=AbortSignal.timeout, durations=[];
 AbortSignal.timeout=ms=>{durations.push(ms);return new AbortController().signal;};
 try{
  const request={abortSignal:async()=>null};
  await service.collectionRpc(request);await service.collectionRpc(request,clock+250_000);await service.collectionRpc(request,clock+12_345);
  assert.deepEqual(durations,[30_000,30_000,12_345]);
 }finally{AbortSignal.timeout=original;}
});

test('a duplicate or held daily worker reservation never loads tenants or sends again',async()=>{
 enable();
 for(const state of ['duplicate','already_reserved','incomplete_previous_run']){
  calls=[];overrides.dekez_collection_begin_run=()=>({data:{claimed:false,state},error:null});
  assert.equal((await service.runRentalCollections(now)).state,state);
  assert.deepEqual(calls.map(c=>c.name),['dekez_collection_scan','dekez_collection_begin_run']);
 }
 assert.equal(sends.length,0);
});

test('worker lease failure or missing reservation fails before any provider request',async()=>{
 enable();
 for(const result of [{data:null,error:Error('private DB detail')},{data:null,error:null}]){
  calls=[];overrides.dekez_collection_begin_run=()=>result;
  await assert.rejects(()=>service.runRentalCollections(now),/run reservation failed/);
  assert.deepEqual(calls.map(c=>c.name),['dekez_collection_scan','dekez_collection_begin_run']);
 }
 assert.equal(sends.length,0);assert.equal(followups.length,0);
});

test('worker exceptions finalize the reservation as failed and do not pretend outcomes completed',async()=>{
 enable();overrides.dekez_collection_preview=()=>({data:null,error:Error('private detail')});
 await assert.rejects(()=>service.runRentalCollections(now),/preview is unavailable/);
 assert.deepEqual(calls.at(-1),{name:'dekez_collection_finish_run',args:{p_run:id(98),p_state:'failed'}});
 assert.equal(sends.length,0);assert.equal(followups.length,0);
});

test('lost worker finalization requires review and cannot trigger another send or digest',async()=>{
 enable();current.pending_verification=true;
 overrides.dekez_collection_finish_run=()=>({data:null,error:Error('private lease detail')});
 await assert.rejects(()=>service.runRentalCollections(now),/run needs review. Do not retry automatically/);
 assert.equal(sends.length,0);assert.equal(followups.length,0);
});
test('pending proof, sourcechanges, duplicate and revokedconsent never reach provider',async()=>{
 enable();current.pending_verification=true;await service.runRentalCollections(now);assert.equal(sends.length,0);assert.equal(calls.some(c=>c.name==='dekez_collection_claim'),false);
 current.pending_verification=false;for(const state of ['duplicate','source_changed','withheld','pending_review']){overrides.dekez_collection_claim=()=>({data:{claimed:false,state},error:null});await service.runRentalCollections(now);}assert.equal(sends.length,0);
});
test('uncertain/rejected transport and lostfinalization stop immediately withoutretry',async()=>{
 enable();for(const state of ['uncertain','rejected']){calls=[];sends=[];delivery={state,providerId:null,httpStatus:state==='rejected'?429:500,errorCode:state==='rejected'?'provider_rejected':'delivery_uncertain'};assert.equal((await service.runRentalCollections(now)).state,state);assert.equal(sends.length,1);assert.deepEqual(calls.at(-1),{name:'dekez_collection_finish_run',args:{p_run:id(98),p_state:'incomplete'}});}
 overrides.dekez_collection_finish=()=>({data:null,error:Error('secret')});assert.equal((await service.runRentalCollections(now)).state,'uncertain');
});
test('wrongcompany or wrongdate snapshot failsclosed',async()=>{
 enable();for(const change of [{company_id:id(2)},{report_date:'2026-11-14'}]){overrides.dekez_collection_preview=()=>({data:{company_id:id(1),report_date:'2026-11-15',...change},error:null});await assert.rejects(()=>service.collectionPreview(now));}assert.equal(sends.length,0);
});

test('portal login phone normalization never routes to management or the sender',()=>{
 const recipient=load('lib/rental-collection/recipient.ts');
 assert.equal(recipient.tenantReminderRecipient('019-123 4567'),'60191234567');
 assert.equal(recipient.tenantReminderRecipient('+60 (19) 123-4567'),'60191234567');
 for(const phone of ['0198894911','+60 19 8894911','60198894911','0168173911','60168173911','0188702371','60188702371','+601234','01+91234567','bad',null])assert.equal(recipient.tenantReminderRecipient(phone),null);
});

test('login alone, withdrawn consent, changed number and unverified WhatsApp ownership prevent claims',async()=>{
 enable();
 for(const change of [{whatsapp_ownership_verified:false},{recipient_source:undefined},{phone:'60198894911'},{phone:'60168173911'},{delivery_blocks:['previous_tenant_or_room_mismatch']},{policy:{...item().policy,consent:'opted_out'}},{policy:{...item().policy,approved_recipient:'60193333333'}}]){
  current={...item(),...change};await service.runRentalCollections(now);
 }
 assert.equal(sends.length,0);assert.equal(calls.some(c=>c.name==='dekez_collection_claim'),false);
});

test('claimed routing/body override cannot reach Whapi and reservation stays retained for review',async()=>{
 enable();
 for(const override of [{recipient:'60198894911'},{recipient:'60193333333'},{body:'changed after review'}]){
  overrides.dekez_collection_claim=args=>({data:{claimed:true,attempt_id:id(99),recipient:current.phone,body:args.p_body,...override},error:null});
  assert.equal((await service.runRentalCollections(now)).state,'recipient_review_required');
 }
 assert.equal(sends.length,0);assert.equal(calls.filter(c=>c.name==='dekez_collection_finish').at(-1).args.p_error,'worker_interrupted');
 assert.deepEqual(calls.at(-1),{name:'dekez_collection_finish_run',args:{p_run:id(98),p_state:'incomplete'}});
});

test('requested today batch and tomorrow9AM remain proposals, not time-window bypasses',()=>{
 const cfg=JSON.parse(fs.readFileSync('config/rental-collection-cron.pending.json','utf8'));
 assert.equal(cfg.reviewOnly,true);assert.equal(cfg.oneTimeBatch.mode,'dry_run_only');
 assert.equal(cfg.oneTimeBatch.outsideWindowSendingSupported,false);assert.equal(cfg.oneTimeBatch.noCatchUpWithoutFreshApproval,true);
 assert.equal(cfg.requestedFirstLocalRun,'2026-10-28T09:00:00+08:00');
 assert.equal(new Date(cfg.requestedFirstLocalRun).toISOString(),new Date(cfg.requestedFirstUtcRun).toISOString());
 assert.equal(cfg.appendAfterApproval.schedule,'0 1 * * *');
});
test('cron mandatorytimingsafeauthentication and ignores suppliedtarget/date/body',async()=>{
 for(const headers of [{},{authorization:'Bearer undefined'},{authorization:'Bearer wrong'}])assert.equal((await route.GET(new Request('https://example.invalid/api/rental-collections',{headers}))).status,401);
 process.env.CRON_SECRET='synthetic-cron';assert.equal((await route.GET(new Request('https://example.invalid/api/rental-collections?company=evil&to=123',{headers:{authorization:'Bearer synthetic-cron'}}))).status,200);assert.equal(calls.length,0);
});
test('seven productioncron definitions unchanged and branchdeploy disabled; no financialenforcement imports',()=>{
 const cfg=JSON.parse(fs.readFileSync('vercel.json','utf8'));assert.equal(cfg.crons.length,7);assert.equal(cfg.crons.find(x=>x.path==='/api/management-report').schedule,'0 12 * * *');assert.equal(cfg.crons.some(x=>x.path==='/api/rental-collections'),false);
 assert.equal(cfg.git.deploymentEnabled['feature/rental-collection-policy-20261027'],false);
 const source=fs.readFileSync('lib/rental-collection/service.ts','utf8');assert.doesNotMatch(source,/ttlock|\.from\(|\.update\(|\.delete\(/i);
});
