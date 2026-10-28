const test=require('node:test'),assert=require('node:assert/strict'),React=require('react');
const {renderToStaticMarkup}=require('react-dom/server'),loader=require('./marketplace-component-loader.cjs');
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const form=(changes={})=>{const f=new FormData();for(const[k,v]of Object.entries({tenant:id(4),request:id(100),kind:'consent_evidence',observed_on:'2026-10-27',source:'in_person',reference:'Synthetic reference only',notes:'Actual synthetic response for fixture, not real consent',confirmed:'yes',...changes}))f.set(k,v);return f;};
let manager,admin,ready,result,calls,refresh,originalFetch;
const overrides={'server-only':{},'next/cache':{revalidatePath:p=>refresh.push(p)},
 './authorization':{reminderManager:async()=>manager},
 './config':{collectionConfig:()=>({scopeReady:ready,companyId:id(1)})},
 './service':{collectionRpc:r=>r},
 '@/lib/rental-collection/authorization':{reminderManager:async()=>manager},
 '@/lib/management-report/authorization':{reportAdministrator:async()=>admin},
 '@/lib/rental-collection/config':{collectionConfig:()=>({scopeReady:ready,companyId:id(1)})},
 '@/lib/rental-collection/service':{collectionRpc:r=>r},
 '@/lib/supabase/admin':{createAdminClient:()=>({rpc:async(name,args)=>{calls.push({name,args});if(result instanceof Error)throw result;return result;}})},
};
const load=loader(overrides),actions=load('app/rent-due-tracker/reminder-followups/evidence-actions.ts');
const model=load('lib/rental-collection/proposals.ts'),service=load('lib/rental-collection/proposal-service.ts');
test.beforeEach(()=>{manager=id(3);admin=null;ready=true;result={data:{state:'pending'},error:null};calls=[];refresh=[];originalFetch=global.fetch;global.fetch=()=>{throw Error('Live requests forbidden');};});
test.afterEach(()=>{global.fetch=originalFetch;});
test('Management can submit only pending evidence with fresh server-derived authority',async()=>{
 const r=await actions.submitReminderEvidence({},form({company:id(2),actor:id(99),consent:'opted_in',enabled:'true'}));
 assert(r.ok);assert.equal(calls[0].name,'dekez_collection_submit_evidence');assert.equal(calls[0].args.p_company,id(1));assert.equal(calls[0].args.p_actor,id(3));
 assert.doesNotMatch(JSON.stringify(calls),/p_consent|p_enabled|p_approved/);assert.match(r.message,/No consent, login number, payment record/);
});
test('anonymous, revoked, unconfigured and Management review attempts do not reach RPC',async()=>{
 manager=null;assert.equal((await actions.submitReminderEvidence({},form())).ok,false);
 manager=id(3);ready=false;assert.equal((await actions.submitReminderEvidence({},form())).ok,false);
 ready=true;assert.equal((await actions.reviewReminderEvidence({},form({proposal:id(100),decision:'reviewed',reason:'Actual review fixture'}))).ok,false);assert.equal(calls.length,0);
});
test('date/source/ref/notes/confirmation are real required inputs; no future or fabricated defaults',()=>{
 const now=new Date('2026-10-27T16:00:00Z');assert(model.parseReminderEvidence(form({observed_on:'2026-10-28'}),now));
 for(const x of [{observed_on:'2026-10-29'},{observed_on:'2026-02-30'},{observed_on:''},{source:'__proto__'},{kind:'constructor'},
  {tenant:'tenant-4'},{request:''},{reference:'x'.repeat(501)},{notes:'x'},{reference:'unsafe\nreference'},{notes:'unsafe\u007fnotes'},{confirmed:''}])assert.equal(model.parseReminderEvidence(form(x),now),null);
 assert.equal(model.evidenceToday(new Date('2026-10-27T15:59:59Z')),'2026-10-27');
});
test('number proposals normalize only for proposed field; protected/arbitrary numbers rejected',async()=>{
 assert.equal((await actions.submitReminderEvidence({},form({kind:'phone_correction',proposed_phone:'0192222222'}))).ok,true);
 assert.equal(calls[0].args.p_proposed_phone,'60192222222');
 for(const proposed_phone of ['60188702371','60168173911','60198894911','60192222222@lid',''])assert.equal(model.parseReminderEvidence(form({kind:'phone_correction',proposed_phone})),null);
 assert.equal(model.parseReminderEvidence(form({proposed_phone:'0192222222'})),null);
});
test('submission duplicates return success only for explicit already_submitted; errors stay private',async()=>{
 result={data:{state:'already_submitted'},error:null};assert((await actions.submitReminderEvidence({},form())).ok);
 refresh=[];for(const x of [{data:null,error:{message:'private SQL secret'}},new Error('private SQL secret'),{data:{state:'approved'},error:null}]){result=x;const r=await actions.submitReminderEvidence({},form());assert.equal(r.ok,false);assert.doesNotMatch(r.message,/private SQL secret/);}assert.equal(refresh.length,0);
});
test('Super Admin disposition is explicit and cannot mutate actual permissions or phone',async()=>{
 admin=id(3);result={data:{state:'reviewed'},error:null};
 const f=form({proposal:id(100),decision:'reviewed',reason:'Actual documented review',company:id(2),actor:id(99),phone:'60192222222'});
 assert((await actions.reviewReminderEvidence({},f)).ok);
 assert.deepEqual(calls,[{name:'dekez_collection_review_evidence',args:{p_company:id(1),p_actor:id(3),p_proposal:id(100),p_decision:'reviewed',p_reason:'Actual documented review'}}]);
 for(const x of [{decision:'approve_consent'},{proposal:'invalid'},{confirmed:''},{reason:'short'}])assert.equal((await actions.reviewReminderEvidence({},form({proposal:id(100),decision:'reviewed',reason:'Valid review fixture',...x}))).ok,false);
 assert.equal(calls.length,1);
});
test('evidence list is freshly authorized, bounded and errors never leak',async()=>{
 result={data:{items:[],next_cursor:null},error:null};assert.deepEqual(await service.reminderEvidenceList(),result.data);assert.equal(calls[0].args.p_limit,25);
 const count=calls.length;assert.equal(await service.reminderEvidenceList('arbitrary'),null);manager=null;assert.equal(await service.reminderEvidenceList(),null);assert.equal(calls.length,count);
 manager=id(3);result=new Error('private SQL');assert.equal(await service.reminderEvidenceList(),null);
});
test('Management STOP-only action uses existing suppression RPC and cannot be forged into opt-in',async()=>{
 result={data:{state:'reviewed',consent:'opted_out',suppressed:true},error:null};
 const r=await actions.recordManagementStop({},form({recipient:'60191111111',confirmed_stop:'yes',action:'record_opt_in',company:id(2),actor:id(99),proposed_phone:'60192222222'}));
 assert(r.ok);assert.equal(calls.length,1);const call=calls[0];assert.equal(call.name,'dekez_collection_review_contact');
 assert.equal(call.args.p_company,id(1));assert.equal(call.args.p_actor,id(3));assert.equal(call.args.p_action,'record_opt_out');
 assert.equal(call.args.p_recipient,'60191111111');assert.match(call.args.p_reason,/STOP received 2026-10-27 \(in_person\)/);
 assert.doesNotMatch(JSON.stringify(calls),/record_opt_in|p_proposed_phone|p_enabled|clear_hold/);assert.match(r.message,/No message was sent/);
});
test('STOP requires fresh Management gate and genuine bounded evidence; no arbitrary recipient or future date',async()=>{
 const stop=changes=>form({recipient:'60191111111',confirmed_stop:'yes',...changes});
 manager=null;assert.equal((await actions.recordManagementStop({},stop())).ok,false);manager=id(3);
 for(const change of [{confirmed_stop:''},{recipient:'0191111111'},{recipient:'60188702371'},{observed_on:'2099-01-01'},{source:'invented'},
  {reference:'x'},{notes:'x'.repeat(401)},{notes:'Not safe\nSTOP'}])assert.equal((await actions.recordManagementStop({},stop(change))).ok,false);
 assert.equal(calls.length,0);
});
test('stale phone or failed STOP persistence never claims suppression and escalates to Admin without leaking errors',async()=>{
 for(const x of [{data:null,error:{message:'private SQL stale phone'}},{data:{state:'reviewed',consent:'opted_in',suppressed:false},error:null},new Error('private SQL')]){
  result=x;const r=await actions.recordManagementStop({},form({recipient:'60191111111',confirmed_stop:'yes'}));
  assert.equal(r.ok,false);assert.match(r.message,/Contact Admin immediately/);assert.doesNotMatch(r.message,/private SQL/);
 }assert.equal(refresh.length,0);
});
test('forms render no assumed dates/consent and no send or login mutation controls',()=>{
 const ui=loader({'./evidence-actions':{submitReminderEvidence:async()=>{},reviewReminderEvidence:async()=>{}}})('app/rent-due-tracker/reminder-followups/evidence-form.tsx');
 const html=renderToStaticMarkup(React.createElement(ui.ReminderEvidenceForm,{tenant:id(4),request:id(100),today:'2026-10-28'}));
 for(const text of ['Pending Super Admin','Actual confirmation date','Evidence source','Actual tenant response','genuine evidence','urgent STOP'])assert(html.includes(text),text);
 assert.doesNotMatch(html,/name="observed_on"[^>]*value=|checked=""|name="consent"|name="enabled"|Send now/);
});
test('Management STOP form is explicit, read-only recipient and contains no choice to grant permission',()=>{
 const {ManagementStopForm}=loader({'./evidence-actions':{recordManagementStop:async()=>{}}})('app/rent-due-tracker/reminder-followups/evidence-form.tsx');
 const html=renderToStaticMarkup(React.createElement(ManagementStopForm,{tenant:id(4),recipient:'60191111111',today:'2026-10-28'}));
 assert.match(html,/Record an actual STOP immediately/);assert.match(html,/confirmed_stop/);assert.match(html,/name="recipient" value="60191111111"/);
 assert.doesNotMatch(html,/name="action"|record_opt_in|clear_hold|checked=""|name="observed_on"[^>]*value=/);
});
test('review list is visible to scoped Management but disposition form only to Super Admin',()=>{
 const {ReminderEvidenceList}=loader({'./evidence-form':{ReminderEvidenceReview:()=>React.createElement('div',null,'SUPER ADMIN DISPOSITION')}})('app/rent-due-tracker/reminder-followups/evidence-list.tsx');
 const result={items:[{id:id(100),tenant_name:'<script>tenant</script>',kind:'consent_evidence',observed_on:'2026-10-27',source:'in_person',status:'pending',reference:'Fixture reference',notes:'Fixture only',submitted_at:'2026-10-28',actor:id(3),login_phone_snapshot:null,review:null}],next_cursor:null};
 const html=renderToStaticMarkup(ReminderEvidenceList({result,mayReview:false}));assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>|SUPER ADMIN DISPOSITION/);
 assert.match(renderToStaticMarkup(ReminderEvidenceList({result,mayReview:true})),/SUPER ADMIN DISPOSITION/);
 assert.match(renderToStaticMarkup(ReminderEvidenceList({result:null,mayReview:true})),/until its reviewed migration is installed/);
});
