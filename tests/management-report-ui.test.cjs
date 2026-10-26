const test=require('node:test'),assert=require('node:assert/strict'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const loader=require('./marketplace-component-loader.cjs');
let authorized=true,previewCalls=0;
const page=loader({'server-only':{},'@/lib/auth/session':{requireRole:async()=>{if(!authorized)throw Error('Denied');}},'next/navigation':{redirect:()=>{throw Error('Redirect');}},'@/lib/management-report/authorization':{reportAdministrator:async()=>authorized?'fixture-admin':null},'@/lib/management-report/config':{reportConfig:()=>({recipient:'60198894911',configured:false,scopeReady:false,sendEnabled:false,testEnabled:false,scheduleEnabled:false})},'@/lib/management-report/service':{reportPreview:async()=>{previewCalls++;throw Error('Should not query');}},'./actions':{oneTimeTestAction:async()=>{throw Error('Must not authorize or send');}}})('app/admin-setup/management-report/page.tsx');
test('Admin page renders disabled test control and honest setup state, with no data/HTTP request',async()=>{
 authorized=true;const html=renderToStaticMarkup(await page.default());assert.match(html,/Daily Management Report/);assert.match(html,/<button[^>]*disabled/);assert.match(html,/No sample figures/);assert.equal(previewCalls,0);assert.doesNotMatch(html,/WHAPI_TOKEN|service_role|Bearer/);
});
test('non-Admin cannot render preview or controls',async()=>{authorized=false;await assert.rejects(page.default(),/Denied/);assert.equal(previewCalls,0);});
test('test control exposes accessible status and respects enabled/disabled input',()=>{
 const component=loader({'./actions':{oneTimeTestAction:async()=>({phase:'finished',message:'disabled'})}})('app/admin-setup/management-report/test-control.tsx').TestReportControl;
 const disabled=renderToStaticMarkup(React.createElement(component,{enabled:false}));assert.match(disabled,/disabled/);assert.match(disabled,/role="status"/);assert.match(disabled,/60198894911/);assert.doesNotMatch(disabled,/60168173911/);
 const enabled=renderToStaticMarkup(React.createElement(component,{enabled:true}));assert.doesNotMatch(enabled,/<button[^>]*disabled="/);
});
