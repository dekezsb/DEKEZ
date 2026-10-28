const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const loader=require('./marketplace-component-loader.cjs');
let actor,ready,result,calls,refresh,authCalls,priorFetch;
const actions=loader({'server-only':{},'next/cache':{revalidatePath:p=>refresh.push(p)},
 '@/lib/management-report/authorization':{reportAdministrator:async()=>{authCalls++;return actor;}},
 '@/lib/rental-collection/config':{collectionConfig:()=>({scopeReady:ready,companyId:'00000000-0000-0000-0000-000000000001'})},
 '@/lib/supabase/admin':{createAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});if(result instanceof Error)throw result;return result;}})},
})('app/admin-setup/rental-reminders/actions.ts');
function form(changes={}){const f=new FormData();for(const[k,v]of Object.entries({tenant:'00000000-0000-0000-0000-000000000004',recipient:'60191111111',action:'verify_ownership',reference:'Evidence fixture 2026-10-27',reason:'Confirmed intended person with recorded evidence',confirmed:'yes',...changes}))f.set(k,v);return f;}
test.beforeEach(()=>{actor='00000000-0000-0000-0000-000000000003';ready=true;result={data:{state:'reviewed'},error:null};calls=[];refresh=[];authCalls=0;priorFetch=global.fetch;global.fetch=()=>{throw Error('Live requests forbidden in action tests');};});
test.afterEach(()=>{global.fetch=priorFetch;});
test('contact review uses fresh admin and configured company, never caller actor/company',async()=>{
 const r=await actions.reviewReminderContact({},form({actor:'attacker',company:'other-company'}));
 assert.equal(r.ok,true);assert.equal(calls[0].name,'dekez_collection_review_contact');
 assert.equal(calls[0].args.p_actor,actor);assert.equal(calls[0].args.p_company,'00000000-0000-0000-0000-000000000001');
 assert.equal(calls[0].args.p_recipient,'60191111111');assert.equal(refresh.length,1);assert.match(r.message,/No message was sent/);
});
test('unauthenticated or unconfigured contact review performs no database calls',async()=>{
 actor=null;assert.equal((await actions.reviewReminderContact({},form())).ok,false);
 actor='admin';ready=false;assert.equal((await actions.reviewReminderContact({},form())).ok,false);assert.equal(calls.length,0);
});
test('contact evidence needs confirmation, bounded references and an allowlisted action',async()=>{
 for(const input of [{confirmed:''},{reference:''},{reason:'x'},{action:'activate_sending'},{tenant:'not-uuid'},{reference:'x'.repeat(501)},{reason:'unsafe\nreference'}])
  assert.equal((await actions.reviewReminderContact({},form(input))).ok,false);
 assert.equal(calls.length,0);
});
test('protected management numbers and alternate/noncanonical recipients cannot enter tenant review',async()=>{
 for(const recipient of ['60168173911','60198894911','60188702371','0191111111','+60191111111','60191111111@s.whatsapp.net'])
  assert.equal((await actions.reviewReminderContact({},form({recipient}))).ok,false);
 assert.equal(calls.length,0);
});
test('database denial never leaks SQL or marks unrecorded consent as successful',async()=>{
 for(const value of [{data:null,error:{message:'secret SQL'}},{data:{state:'denied'},error:null},new Error('secret SQL')]){
  result=value;const r=await actions.reviewReminderContact({},form());assert.equal(r.ok,false);assert.doesNotMatch(r.message,/secret SQL/);
 }
 assert.equal(refresh.length,0);
});

const profile='00000000-0000-0000-0000-000000000005',attempt='00000000-0000-0000-0000-000000000099';
const recipientForm=(changes={})=>form({profile,...changes});
const followupForm=(changes={})=>form({attempt,...changes});

test('management recipient review uses fresh Admin identity and configured company, not hidden authority fields',async()=>{
 const r=await actions.reviewFailureRecipient({},recipientForm({actor:'forged',company:'forged-company',recipient:'60198894911',enabled:'true'}));
 assert.equal(r.ok,true);assert.equal(authCalls,1);
 assert.deepEqual(calls,[{name:'dekez_collection_review_failure_recipient',args:{p_company:'00000000-0000-0000-0000-000000000001',p_actor:actor,p_recipient_profile:profile,p_action:'verify_ownership',p_reference:'Evidence fixture 2026-10-27',p_reason:'Confirmed intended person with recorded evidence'}}]);
 assert.deepEqual(refresh,['/rent-due-tracker/reminder-followups']);assert.match(r.message,/No report was sent/);
 assert.equal(Object.hasOwn(calls[0].args,'p_recipient'),false);
});

test('recipient mutation rechecks Admin on every request and denies revoked authorization or missing scope',async()=>{
 assert.equal((await actions.reviewFailureRecipient({},recipientForm())).ok,true);
 actor=null;assert.equal((await actions.reviewFailureRecipient({},recipientForm())).ok,false);
 actor='00000000-0000-0000-0000-000000000003';ready=false;assert.equal((await actions.reviewFailureRecipient({},recipientForm())).ok,false);
 assert.equal(authCalls,3);assert.equal(calls.length,1);assert.equal(refresh.length,1);
});

test('recipient review accepts only three evidence actions and standard UUID, never an arbitrary phone or sending command',async()=>{
 for(const action of ['verify_ownership','record_opt_in','record_opt_out'])assert.equal((await actions.reviewFailureRecipient({},recipientForm({action}))).ok,true);
 assert.equal(calls.length,3);
 for(const change of [{profile:'00000000-0000-0000-000000000005'},{profile:'60188702371'},{profile:''},{action:'activate_sending'},{action:'change_recipient'},{action:'review_resubscription'}])assert.equal((await actions.reviewFailureRecipient({},recipientForm(change))).ok,false);
 assert.equal(calls.length,3);
});

test('recipient evidence is confirmed, bounded to database10–500 rules and rejects control characters/files',async()=>{
 for(const change of [{confirmed:''},{confirmed:'true'},{reference:'x'.repeat(9)},{reason:'x'.repeat(9)},{reference:'x'.repeat(501)},{reason:'x'.repeat(501)},{reference:'valid but\nunsafe'},{reason:'valid but\tunsafe'}])assert.equal((await actions.reviewFailureRecipient({},recipientForm(change))).ok,false);
 const file=recipientForm();file.set('reference',new Blob(['not evidence text']));assert.equal((await actions.reviewFailureRecipient({},file)).ok,false);
 assert.equal(calls.length,0);
 assert.equal((await actions.reviewFailureRecipient({},recipientForm({reference:'x'.repeat(10),reason:'x'.repeat(500)}))).ok,true);
});

test('recipient review masks database errors, absent data and unexpected result states without revalidation',async()=>{
 for(const value of [{data:null,error:{message:'private token SQL'}},{data:null,error:null},{data:{state:'denied'},error:null},new Error('private token SQL')]){
  result=value;const r=await actions.reviewFailureRecipient({},recipientForm());assert.equal(r.ok,false);assert.doesNotMatch(r.message,/private token SQL/);
 }assert.equal(refresh.length,0);
});

test('follow-up resolution uses only the scoped attempt/reference/reason RPC and preserves business records',async()=>{
 result={data:{state:'resolved'},error:null};
 const r=await actions.resolveReminderFollowup({},followupForm({actor:'forged',company:'other',recipient:'60198894911',state:'delivered',paid:'true'}));
 assert.equal(r.ok,true);assert.equal(authCalls,1);
 assert.deepEqual(calls,[{name:'dekez_collection_resolve_followup',args:{p_company:'00000000-0000-0000-0000-000000000001',p_actor:actor,p_attempt:attempt,p_reference:'Evidence fixture 2026-10-27',p_reason:'Confirmed intended person with recorded evidence'}}]);
 assert.ok(refresh.includes('/rent-due-tracker/reminder-followups'));
 assert.doesNotMatch(JSON.stringify(calls),/p_state|p_recipient|p_paid|p_enabled/);
});

test('resolved replay is an acknowledged task outcome, not a second message or delivery override',async()=>{
 for(const state of ['resolved','already_resolved']){result={data:{state},error:null};assert.equal((await actions.resolveReminderFollowup({},followupForm())).ok,true);}
 assert.equal(calls.length,2);assert.ok(calls.every(call=>call.name==='dekez_collection_resolve_followup'));
});

test('follow-up resolution denies unauthenticated, revoked and unconfigured requests before database access',async()=>{
 actor=null;assert.equal((await actions.resolveReminderFollowup({},followupForm())).ok,false);
 actor='00000000-0000-0000-0000-000000000003';ready=false;assert.equal((await actions.resolveReminderFollowup({},followupForm())).ok,false);
 assert.equal(authCalls,2);assert.equal(calls.length,0);assert.equal(refresh.length,0);
});

test('follow-up resolution requires a UUID, explicit confirmation and10–500 character safe evidence',async()=>{
 for(const change of [{attempt:''},{attempt:'not-a-uuid'},{attempt:'00000000-0000-0000-000000000099'},{confirmed:''},{confirmed:'true'},{reference:'x'.repeat(9)},{reason:'x'.repeat(9)},{reference:'x'.repeat(501)},{reason:'x'.repeat(501)},{reference:'valid but\nunsafe'},{reason:'valid but\u0000unsafe'}])assert.equal((await actions.resolveReminderFollowup({},followupForm(change))).ok,false);
 assert.equal(calls.length,0);
});

test('follow-up denial and exceptions are masked; unresolved task is not shown as successful',async()=>{
 for(const value of [{data:null,error:{message:'tenant private SQL'}},{data:null,error:null},{data:{state:'denied'},error:null},new Error('tenant private SQL')]){
  result=value;const r=await actions.resolveReminderFollowup({},followupForm());assert.equal(r.ok,false);assert.doesNotMatch(r.message,/tenant private SQL/);
 }assert.equal(refresh.length,0);
});

test('Admin review actions contain no sending, credential changes, financial updates or physical access operations',()=>{
 const source=fs.readFileSync('app/admin-setup/rental-reminders/actions.ts','utf8');
 assert.doesNotMatch(source,/sendWhapi|gate\.whapi\.cloud|fetch\(|WHAPI_TOKEN|process\.env\.[A-Z_]+\s*=|ttlock|\.from\(|\.update\(|\.delete\(/);
 assert.match(source,/reportAdministrator/);
});

test('new follow-up page stays within Rent Due Tracker and callback needs no portal-session redirect exception',()=>{
 const read=loader({});const roles=read('lib/auth/roles.ts'),access=read('lib/auth/access.ts');
 const callback='/api/webhooks/whapi-rental-reminders',followup='/rent-due-tracker/reminder-followups';
 assert.equal(roles.protectedRoutes.some(route=>callback.startsWith(route)),false);
 assert.equal(roles.protectedRoutes.some(route=>followup.startsWith(route)),true);
 assert.equal(access.moduleForPath(followup),'rent_due_tracker');
 const middleware=fs.readFileSync('lib/supabase/middleware.ts','utf8');
 assert.match(middleware,/isProtectedRoute && !claims\?\.sub/);
 assert.match(fs.readFileSync('app/api/webhooks/whapi-rental-reminders/route.ts','utf8'),/timingSafeEqual/);
});

test('Management page authorization refreshes real user and asks database for current configured company scope',async()=>{
 let context={role:'admin',user:{id:profile},access:{},company:'forged-company'},allowed=true,identity={data:{user:{id:profile}},error:null},permissionError=null;
 const checks=[],rpc=[];
 const manager=loader({'server-only':{},'@/lib/auth/session':{getOptionalUserAccess:async()=>context},
  '@/lib/auth/access':{hasModuleAccess:(_access,module,level)=>{checks.push({module,level});return allowed;}},
  './config':{collectionConfig:()=>({scopeReady:ready,companyId:'00000000-0000-0000-0000-000000000001'})},
  '@/lib/supabase/server':{createClient:async()=>({auth:{getUser:async()=>identity}})},
  '@/lib/supabase/admin':{createAdminClient:()=>({rpc:async(name,args)=>{rpc.push({name,args});return {error:permissionError};}})},
 })('lib/rental-collection/authorization.ts').reminderManager;
 assert.equal(await manager(),profile);
 assert.deepEqual(checks,[{module:'rent_due_tracker',level:'manage'}]);
 assert.deepEqual(rpc,[{name:'dekez_collection_assert_admin',args:{p_company:'00000000-0000-0000-0000-000000000001',p_actor:profile}}]);
 permissionError={message:'scope removed'};assert.equal(await manager(),null);permissionError=null;
 const prior=rpc.length;identity={data:{user:{id:'forged'}},error:null};assert.equal(await manager(),null);
 identity={data:{user:{id:profile}},error:{message:'expired'}};assert.equal(await manager(),null);
 identity={data:{user:{id:profile}},error:null};allowed=false;assert.equal(await manager(),null);allowed=true;
 context={...context,role:'tenant'};assert.equal(await manager(),null);context={...context,role:'owner'};assert.equal(await manager(),null);
 context=null;assert.equal(await manager(),null);assert.equal(rpc.length,prior);
});

test('follow-up page checks authorized Management scope before loading roster; mutation controls require stronger Admin gate',async()=>{
 let manager=false,administrator=false;const sequence=[];
 const page=loader({
  'next/navigation':{redirect:path=>{throw Error('redirect:'+path);}},
  '@/lib/rental-collection/authorization':{reminderManager:async()=>{sequence.push('scope');return manager?profile:null;}},
  '@/lib/management-report/authorization':{reportAdministrator:async()=>{sequence.push('admin');return administrator?actor:null;}},
  '@/lib/rental-collection/failure-service':{collectionFailurePreview:async(_now,portal)=>{sequence.push(['roster',portal]);return {allHistoryLoaded:true,fullPortalReport:'Synthetic authorized roster',body:'Generic synthetic preview',recipientAuthorization:null,reviewableAttempts:[]};}},
  '@/lib/rental-collection/proposal-service':{reminderEvidenceList:async()=>null},
  './evidence-actions':{submitReminderEvidence:async()=>{throw Error('No writes during rendering');},reviewReminderEvidence:async()=>{throw Error('No writes during rendering');},recordManagementStop:async()=>{throw Error('No writes during rendering');}},
  '@/app/admin-setup/rental-reminders/failure-recipient-review':{FailureRecipientReview:()=> 'RESTRICTED RECIPIENT REVIEW'},
  '@/app/admin-setup/rental-reminders/followup-review':{FollowupReview:()=> 'RESTRICTED RESOLUTION'},
 })('app/rent-due-tracker/reminder-followups/page.tsx').default;
 await assert.rejects(()=>page(),/redirect:\/dashboard\?error=access_denied/);assert.deepEqual(sequence,['scope']);
 sequence.length=0;manager=true;
 const {renderToStaticMarkup}=require('react-dom/server');const html=renderToStaticMarkup(await page());
 assert.deepEqual(sequence,['scope',['roster',true],'admin']);assert.match(html,/Synthetic authorized roster/);assert.doesNotMatch(html,/RESTRICTED RECIPIENT REVIEW|RESTRICTED RESOLUTION/);
 administrator=true;assert.match(renderToStaticMarkup(await page()),/RESTRICTED RECIPIENT REVIEW/);
});
