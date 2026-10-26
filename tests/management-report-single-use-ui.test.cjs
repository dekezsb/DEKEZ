const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const loader=require('./marketplace-component-loader.cjs');
const admin='00000000-0000-4000-8000-000000000003',authorizationId='00000000-0000-4000-8000-000000000010';
const initial={phase:'idle',message:''};
const grant={state:'ready',authorizationId,expiresAt:'2030-10-25T12:05:00.000Z',reportDate:'2030-10-25',recipient:'60198894911',body:'[TEST]\nDEKEZ Daily Management Report\nSynthetic frozen totals'};
function form(fields){const result=new FormData();for(const [key,value] of Object.entries(fields))result.set(key,value);return result;}
function actionFixture(){
 let actor=admin,authCalls=0,requestResult=grant,executeResult={state:'accepted'},revokeResult={state:'revoked'};const calls=[];
 const actions=loader({
  '@/lib/management-report/authorization':{reportAdministrator:async()=>{authCalls++;return actor;}},
  '@/lib/management-report/service':{deliverManagementReport:async()=>{throw Error('Legacy path must not run');}},
  '@/lib/management-report/single-use-test':{
   requestTestAuthorization:async(...args)=>{calls.push(['request',...args]);return requestResult;},
   executeAuthorizedTest:async(...args)=>{calls.push(['execute',...args]);if(executeResult instanceof Error)throw executeResult;return executeResult;},
   revokeTestAuthorization:async(...args)=>{calls.push(['cancel',...args]);return revokeResult;},
  },
 })('app/admin-setup/management-report/actions.ts');
 return {action:actions.oneTimeTestAction,calls,setActor:value=>actor=value,setRequest:value=>requestResult=value,setExecute:value=>executeResult=value,setRevoke:value=>revokeResult=value,authCalls:()=>authCalls};
}

test('all one-time test intents authenticate freshly and deny ordinary users without calling services',async()=>{
 const fixture=actionFixture();fixture.setActor(null);
 for(const intent of ['request','execute','cancel']){
  const result=await fixture.action(initial,form({intent,authorizationId,confirm:'send-once'}));
  assert.match(result.message,/Not authorized/);assert.equal(result.phase,'finished');
 }
 assert.equal(fixture.authCalls(),3);assert.deepEqual(fixture.calls,[]);
});
test('request returns only the server-generated frozen preview and never sends; forged scope is ignored',async()=>{
 const fixture=actionFixture();const result=await fixture.action({phase:'ready',authorization:{body:'forged'}},form({intent:'request',actor:'evil',recipient:'123',company:'evil',body:'evil'}));
 assert.equal(result.phase,'ready');assert.deepEqual(result.authorization,{authorizationId,expiresAt:grant.expiresAt,reportDate:grant.reportDate,recipient:grant.recipient,body:grant.body});
 assert.deepEqual(fixture.calls,[['request',admin]]);assert.match(result.message,/Nothing has been sent/);
});
test('execution requires exact explicit confirmation and a valid authorization ID before any send service',async()=>{
 const fixture=actionFixture();
 for(const fields of [{intent:'execute',authorizationId},{intent:'execute',authorizationId,confirm:'yes'},{intent:'execute',authorizationId:'bad',confirm:'send-once'},{intent:'anything',authorizationId,confirm:'send-once'}]){
  const result=await fixture.action(initial,form(fields));assert.equal(result.phase,'finished');assert.equal(result.authorization,undefined);
 }
 assert.deepEqual(fixture.calls,[]);
});
test('execution passes authenticated actor and UUID only, ignoring forged recipient, company and report text',async()=>{
 const fixture=actionFixture();const result=await fixture.action({phase:'ready',authorization:{body:'evil'}},form({intent:'execute',authorizationId,confirm:'send-once',actor:'evil',recipient:'123',company:'evil',body:'evil'}));
 assert.deepEqual(fixture.calls,[['execute',admin,authorizationId]]);assert.equal(result.phase,'finished');assert.equal(result.authorization,undefined);assert.match(result.message,/acceptance is not proof of delivery/);
});
test('session loss between preparing and confirming prevents execution',async()=>{
 const fixture=actionFixture();const prepared=await fixture.action(initial,form({intent:'request'}));fixture.setActor(null);
 const result=await fixture.action(prepared,form({intent:'execute',authorizationId,confirm:'send-once'}));
 assert.match(result.message,/Not authorized/);assert.deepEqual(fixture.calls,[['request',admin]]);
});
test('cancellation uses the authenticated actor and never sends',async()=>{
 const fixture=actionFixture();const result=await fixture.action(initial,form({intent:'cancel',authorizationId,actor:'evil'}));
 assert.deepEqual(fixture.calls,[['cancel',admin,authorizationId]]);assert.match(result.message,/cancelled/);assert.equal(result.authorization,undefined);
});
test('uncertain, duplicate, rejected and error results finish without automatic retry or a reusable UI authorization',async()=>{
 const fixture=actionFixture();
 for(const outcome of [{state:'uncertain'},{state:'accepted',duplicate:true},{state:'rejected'},new Error('secret database detail')]){
  fixture.setExecute(outcome);const result=await fixture.action(initial,form({intent:'execute',authorizationId,confirm:'send-once'}));
  assert.equal(result.phase,'finished');assert.equal(result.authorization,undefined);assert.doesNotMatch(result.message,/secret database detail/);assert.match(result.message,/do not resend|Do not resend|No automatic retry/i);
 }
 assert.equal(fixture.calls.length,4);
});
test('unavailable or duplicate request does not expose an authorization',async()=>{
 const fixture=actionFixture();for(const state of ['unavailable','duplicate']){
  fixture.setRequest({state});const result=await fixture.action(initial,form({intent:'request'}));assert.equal(result.phase,'finished');assert.equal(result.authorization,undefined);
 }
});

function renderControl(state,pending=false,enabled=true){
 const component=loader({react:{...React,useActionState:()=>[state,async()=>{},pending]},'./actions':{oneTimeTestAction:async()=>{throw Error('Rendering must not act');}}})('app/admin-setup/management-report/test-control.tsx').TestReportControl;
 return renderToStaticMarkup(React.createElement(component,{enabled}));
}
test('ready UI shows exact frozen report, fixed recipient, expiry and unchecked explicit confirmation',()=>{
 const html=renderControl({phase:'ready',message:'Nothing sent',authorization:grant});
 assert.match(html,/Synthetic frozen totals/);assert.match(html,/60198894911/);assert.doesNotMatch(html,/60168173911/);assert.match(html,/Expires:/);assert.match(html,/MYT/);
 assert.match(html,/<input[^>]*type="checkbox"[^>]*required/);assert.doesNotMatch(html,/<input[^>]*type="checkbox"[^>]*checked/);
 assert.match(html,/<button[^>]*disabled[^>]*>Send one \[TEST\] report/);assert.match(html,/Cancel authorization/);assert.match(html,/role="status"/);
});
test('pending UI disables controls and completed/uncertain UI cannot retry the approval',()=>{
 const pending=renderControl({phase:'ready',message:'Nothing sent',authorization:grant},true);
 assert.match(pending,/<button[^>]*disabled[^>]*>Processing authorization/);assert.match(pending,/<button[^>]*disabled[^>]*>Cancel authorization/);
 const finished=renderControl({phase:'finished',message:'Delivery is uncertain. Do not resend.'});assert.doesNotMatch(finished,/<button|authorizationId|type="checkbox"/);
});
test('Admin page offers a separate one-time path with ordinary flags off; wrong recipient or active schedule disables it',async()=>{
 for(const [recipient,scheduleEnabled,disabled] of [['60198894911',false,false],['60168173911',false,true],['60111111111',false,true],['60198894911',true,true]]){
  const page=loader({'@/lib/auth/session':{requireRole:async()=>{}},'next/navigation':{redirect:()=>{throw Error('Denied');}},'@/lib/management-report/authorization':{reportAdministrator:async()=>admin},'@/lib/management-report/config':{reportConfig:()=>({recipient,scheduleEnabled,configured:true,scopeReady:false,sendEnabled:false,testEnabled:false})},'@/lib/management-report/service':{reportPreview:async()=>{throw Error('Unexpected preview');}},'./actions':{oneTimeTestAction:async()=>{throw Error('Rendering must not authorize');}}})('app/admin-setup/management-report/page.tsx');
  const html=renderToStaticMarkup(await page.default());assert.equal(/<button[^>]*\sdisabled=""/.test(html),disabled);assert.match(html,/Ordinary sending: Disabled/);assert.match(html,/Ordinary testing: Disabled/);assert.match(html,/no environment switches are changed/);
 }
});
