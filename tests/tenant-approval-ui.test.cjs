const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
const originalLoad = Module._load;
const applications = [
  {id:'check',full_name:'Check-in tenant',registration_mode:'check_in',status:'submitted',verification_status:'pending_verification',payment_status:'pending_verification'},
  {id:'reserve',full_name:'Pending reservation',registration_mode:'reservation',status:'submitted',verification_status:'pending_verification',payment_status:'pending_verification'},
  {id:'approved',full_name:'Approved reservation',registration_mode:'reservation',status:'approved',verification_status:'verified',payment_status:'pending_verification'},
];
const db = {from(table) {
  const query = {select(){return query;},neq(){return query;},in(){return query;},not(){return query;},order(){return query;},
    then(resolve){return Promise.resolve({data:table==='tenant_applications'?applications:[]}).then(resolve);}};
  return query;
}};
Module._resolveFilename = function(request,...args){return originalResolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args);};
Module._load = function(request,...args){
  if(request==='@/lib/auth/session') return {requireRole:async()=> 'admin'};
  if(request==='@/lib/supabase/admin') return {createAdminClient:()=>db};
  if(request==='@/lib/supabase/server') return {createClient:()=>db};
  if(request==='./actions') return {reviewTenantApplication:async()=>{},correctTenantApplicationName:async()=>{}};
  return originalLoad.call(this,request,...args);
};
for(const ext of ['.ts','.tsx']) Module._extensions[ext]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022},fileName:filename,
}).outputText,filename);
const {renderToStaticMarkup}=require('react-dom/server');
const {TenantVerificationContent}=require('../app/tenant-verification/page.tsx');
test('check-in approval shows check-ins and keeps payment verification separate',async()=>{
  const html=renderToStaticMarkup(await TenantVerificationContent({searchParams:Promise.resolve({}),embedded:true,registrationGroup:'check_in'}));
  assert.match(html,/Check-in tenant/);
  assert.match(html,/Approve check-in/);
  assert.match(html,/No payment is marked paid here/);
  assert.doesNotMatch(html,/Pending reservation|Approved reservation/);
});
test('reservation tab shows both pending and approved reservations without check-in approval',async()=>{
  const html=renderToStaticMarkup(await TenantVerificationContent({searchParams:Promise.resolve({}),embedded:true,registrationGroup:'reservation',returnTo:'/verification?view=reservations'}));
  assert.match(html,/Pending reservation/);
  assert.match(html,/Approved reservation/);
  assert.match(html,/Approve reservation/);
  assert.match(html,/No check-in or rent invoice is created/);
  assert.doesNotMatch(html,/Check-in tenant|Approve check-in/);
});
