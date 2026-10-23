const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./renovation-loader.cjs');
const { signFileUrls } = load('lib/storage/signed-urls.ts');
const { reportLoadPlan, loadProfitComparison } = load('lib/accounting/report-loading.ts');

test('admin overview streams separately without dropping any follow-up loader or action', () => {
  const page=fs.readFileSync('app/dashboard/page.tsx','utf8');
  const overview=page.split('async function AdminOverview')[1].split('async function AdminFollowUps')[0];
  assert.match(overview,/await getDashboardSummary\(\)/);
  assert.doesNotMatch(overview,/getRentDueSummary\(|getCashManagementSummary\(|getTenantCheckoutHistory\(/);
  assert.match(page,/<Suspense[^>]*[\s\S]*?<AdminOverview/);
  assert.match(page,/<Suspense[^>]*[\s\S]*?<AdminFollowUps/);
  const followups=page.split('async function AdminFollowUps')[1].split('async function TenantDashboard')[0];
  for(const loader of ['getRentDueSummary','getDepositOutstandingSummary','getCashManagementSummary','getAgreementRenewalReminders','getTenantCheckoutHistory','getStaffElectricityTopUpCandidates']) assert.ok(followups.includes(`${loader}(`));
  for(const component of ['CompanyCashInHand','DepositOutstanding','StaffElectricityTopUp','AgreementRenewalReminders','TenantCheckoutHistory','CompactRentDueTracker']) assert.ok(followups.includes(`<${component}`));
});

test('real React stream sends overview while follow-up data is still pending', {timeout:5000}, async () => {
  const React=require('react'),{renderToPipeableStream}=require('react-dom/server'),{PassThrough}=require('node:stream'),ts=require('typescript');
  let release,followupsReady=false;
  const followups=new Promise(resolve=>{release=()=>{followupsReady=true;resolve({items:[],month:'2026-10'});};});
  const summary={totalRooms:20,occupiedRooms:18,vacantRooms:2,reservedRooms:0,maintenanceRooms:0,totalProperties:1,
    properties:[{id:'test-property',name:'Test property'}],rooms:Array.from({length:20},(_,i)=>({property_id:'test-property',status:i<18?'occupied':'vacant'}))};
  const source=fs.readFileSync('app/dashboard/page.tsx','utf8')+'\nexport const streamingTestDashboard=AdminDashboard;';
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const module={exports:{}};
  new Function('require','module','exports',code)(id=>{
    if(id==='react'||id==='react/jsx-runtime')return require(id);
    if(id==='@/lib/data/organization')return {getDashboardSummary:async()=>summary};
    if(id.startsWith('@/lib/data/'))return new Proxy({},{get:()=>()=>followups});
    return new Proxy({},{get:(_,name)=>({children})=>React.createElement('div',{'data-component':String(name)},children)});
  },module,module.exports);
  let html='',overviewArrived;
  const overview=new Promise(resolve=>{overviewArrived=resolve;});
  const output=new PassThrough();
  output.on('data',chunk=>{html+=chunk.toString();if(html.includes('Test property'))overviewArrived();});
  const finished=new Promise((resolve,reject)=>{output.on('end',resolve);output.on('error',reject);});
  const errors=[];
  const stream=renderToPipeableStream(React.createElement(module.exports.streamingTestDashboard,{query:{}}),{
    onShellReady(){stream.pipe(output);},onError(error){errors.push(error);},
  });
  const timer=setTimeout(()=>{release();stream.abort();},3000);
  try {
    await Promise.race([overview,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Overview did not stream')),2000))]);
    assert.equal(followupsReady,false);
    assert.match(html,/Loading rent, deposits and follow-ups/);
    release();await finished;
    assert.deepEqual(errors,[]);
    for(const name of ['CompanyCashInHand','DepositOutstanding','StaffElectricityTopUp','AgreementRenewalReminders','TenantCheckoutHistory','CompactRentDueTracker']) assert.ok(html.includes(`data-component="${name}"`));
  } finally {clearTimeout(timer);release();stream.abort();}
});

test('report tab matrix skips only unused comparisons and matching candidates', async () => {
  for (const tab of ['overview','profit-loss','balance-sheet','trial-balance','bank','bank-history','journal','ledger']) {
    assert.deepEqual(reportLoadPlan(tab), {
      profitComparison:['overview','profit-loss'].includes(tab),
      bankCandidates:['bank','bank-history'].includes(tab),
    });
    let calls=0;
    const report={netProfit:1234.56};
    const actual=await loadProfitComparison(reportLoadPlan(tab).profitComparison,async()=>{calls++;return report;});
    if (reportLoadPlan(tab).profitComparison) {assert.equal(calls,1);assert.equal(actual,report);}
    else {assert.equal(calls,0);assert.deepEqual(actual.revenue,[]);}
  }
  await assert.rejects(loadProfitComparison(true,async()=>{throw new Error('Incomplete report');}),/Incomplete report/);
  const page=fs.readFileSync('app/reports/page.tsx','utf8');
  assert.match(page,/loadPlan.bankCandidates \? getBankCandidates/);
  assert.match(page,/getProfitLossReport\(supabase, \{ companyId: company.id, startDate: yearStartDate/);
});

function storageMock(respond) {
  const calls = [];
  let active = 0, peak = 0;
  const client = {storage: {from(bucket) {return {async createSignedUrls(paths, ttl) {
    calls.push({bucket, paths, ttl}); active++; peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setImmediate(resolve));
      return respond ? respond(bucket, paths) : {data: [...paths].reverse().map(path => ({path, signedUrl: `${bucket}/${path}`, error: null})), error: null};
    } finally {active--;}
  }};}}};
  return {client, calls, peak: () => peak};
}

test('batch signing preserves order, duplicate references, bucket boundaries and expiry', async () => {
  const mock = storageMock();
  const files = [{bucket:'a',path:'one'},{bucket:'a',path:'two'},{bucket:'a',path:'one'},{bucket:'b',path:'one'},{bucket:'a',path:null}];
  assert.deepEqual(await signFileUrls(mock.client, files, 600), ['a/one','a/two','a/one','b/one',null]);
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(mock.calls[0], {bucket:'a',paths:['one','two'],ttl:600});
});

test('500 file references require 10 requests, never more than 3 concurrent requests', async () => {
  const mock = storageMock();
  const files = Array.from({length:500}, (_,i) => ({bucket:'receipts',path:`${i}.pdf`}));
  const result = await signFileUrls(mock.client, files, 600);
  assert.equal(result.length, 500);
  assert.equal(result[499], 'receipts/499.pdf');
  assert.equal(mock.calls.length, 10);
  assert.equal(mock.peak(), 3);
  assert.ok(mock.calls.every(c => c.paths.length <= 50));
});

test('denied and missing files stay unavailable; no credential fallback or fabricated URL', async () => {
  const mock = storageMock((bucket, paths) => bucket === 'denied'
    ? {data:null,error:new Error('Access denied')}
    : {data:[{path:paths[0],signedUrl:'ok',error:null},{path:paths[1],signedUrl:'must-not-use',error:'Denied'},{path:'unexpected',signedUrl:'wrong',error:null}],error:null});
  assert.deepEqual(await signFileUrls(mock.client, [
    {bucket:'allowed',path:'good'},{bucket:'allowed',path:'bad'},{bucket:'allowed',path:'missing'},
    {bucket:'denied',path:'private'}, {bucket:null,path:'x'},
  ],600), ['ok',null,null,null,null]);
  assert.equal(mock.calls.length,2);
});

test('private links are not cached across requests or clients; empty input does no IO', async () => {
  const a = storageMock(), b = storageMock(() => ({data:null,error:new Error('Denied')}));
  const files = [{bucket:'private',path:'same'}];
  assert.deepEqual(await signFileUrls(a.client, [], 600), []);
  assert.equal(a.calls.length,0);
  await signFileUrls(a.client, files, 600);
  await signFileUrls(a.client, files, 600);
  assert.equal(a.calls.length,2);
  assert.deepEqual(await signFileUrls(b.client, files, 600),[null]);
});

test('installed Supabase SDK preserves credentials, paths and denied-file responses for batch signing', async () => {
  const { createClient } = require('@supabase/supabase-js');
  const requests=[];
  const client=createClient('https://storage-test.invalid','test-key',{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async (url, options)=>{
      requests.push({url:String(url),method:options.method,headers:new Headers(options.headers),body:JSON.parse(options.body)});
      return new Response(JSON.stringify([
        {path:'receipt 1.pdf',signedURL:'/object/sign/receipts/receipt 1.pdf?token=test',error:null},
        {path:'denied.pdf',signedURL:null,error:'Object not found'},
      ]),{status:200,headers:{'Content-Type':'application/json'}});
    }},
  });
  const result=await signFileUrls(client,[{bucket:'receipts',path:'receipt 1.pdf'},{bucket:'receipts',path:'denied.pdf'}],600);
  assert.deepEqual(result,['https://storage-test.invalid/storage/v1/object/sign/receipts/receipt%201.pdf?token=test',null]);
  assert.equal(requests.length,1);
  assert.equal(requests[0].url,'https://storage-test.invalid/storage/v1/object/sign/receipts');
  assert.equal(requests[0].headers.get('authorization'),'Bearer test-key');
  assert.deepEqual(requests[0].body,{expiresIn:600,paths:['receipt 1.pdf','denied.pdf']});
});

test('storage optimization never introduces a write or changes record queries', () => {
  const helper = fs.readFileSync('lib/storage/signed-urls.ts','utf8');
  assert.doesNotMatch(helper, /\.(?:insert|update|upsert|delete|remove|upload)\(/);
  for (const page of ['claims','maintenance','expenses']) {
    const source = fs.readFileSync(`app/${page}/page.tsx`,'utf8');
    assert.match(source, /signFileUrls\(/);
    assert.doesNotMatch(source, /\.createSignedUrl\(/);
  }
});
