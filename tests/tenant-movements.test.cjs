const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename, load = Module._load;
let role = 'super_admin', propertyAccess = 'manage', calls = [], failTable = '', datasets = {};
function db() { return { from(table) {
  const operations = []; const q = {};
  for (const method of ['select','in','order','or','range','eq']) q[method] = (...args) => { operations.push([method,...args]);return q; };
  q.then = (done, reject) => {
    calls.push({table,operations});
    const range = operations.find(o=>o[0]==='range');
    let data = datasets[table] || [];
    if(range) data=data.slice(range[1],range[2]+1);
    return Promise.resolve({data, error:failTable===table ? {message:'failed'} : null}).then(done,reject);
  };
  return q;
} }; }
Module._resolveFilename = function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args);};
Module._load = function(request,...args){
  if(request==='@/lib/auth/session')return {
    requireRole:async(allowed,requirement)=>{assert.equal(requirement.module,'properties');if(!allowed.includes(role)||propertyAccess==='none')throw Error('access denied');return role;},
    getCurrentUserAccess:async()=>({role,access:{properties:propertyAccess,verification:'manage'}}),
  };
  if(request==='@/lib/supabase/admin')return {createAdminClient:db};
  if(request==='@/lib/supabase/server')return {createClient:async()=>db()};
  if(request==='@/lib/data/rent-due')return {malaysiaDateString:()=> '2026-09-15'};
  if(request==='@/lib/data/organization')return {getProperties:async()=>datasets.properties};
  if(request==='@/components/app-link')return {Link:({children,...props})=>React.createElement('a',props,children)};
  if(request==='./payment-form')return {ReservationPaymentForm:()=>React.createElement('span',null,'Existing slip form')};
  if(request==='./actions')return {requestReservationCheckIn:()=>{},cancelReservation:()=>{}};
  return load.call(this,request,...args);
};
for(const ext of ['.ts','.tsx'])Module._extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const {buildTenantMovements,movementMonth,adjacentMovementMonth,getMonthlyTenantMovements}=require('../lib/data/tenant-movements.ts');
const Page=require('../app/tenant-movements/page.tsx').default;
const Reservations=require('../app/reservations/page.tsx').default;
const properties=[{id:'p1',name:'KLB'},{id:'p2',name:'SLS'}];
const row=(id,changes={})=>({id,property_id:'p1',status:'active',check_in_date:'2026-09-05',start_date:'2026-09-05',checkout_date:null,tenants:{full_name:'Tenant '+id},rooms:{room_number:'9'},...changes});
function reset(){role='super_admin';propertyAccess='manage';calls=[];failTable='';datasets={properties,tenancies:[row('one')],audit_logs:[],profiles:[],tenant_applications:[],payment_submissions:[]};}

test('month boundaries and invalid month input are deterministic in Malaysia',()=>{
  assert.equal(movementMonth('2026-09','2026-08-31'),'2026-09');
  for(const bad of ['2026-13','2026-00','2026-09,or','0000-01',undefined]) assert.equal(movementMonth(bad,'2026-09-15'),'2026-09');
  assert.equal(adjacentMovementMonth('2026-12',1),'2027-01');
  assert.equal(adjacentMovementMonth('2026-01',-1),'2025-12');
});

test('report uses saved check-in date, retains same-month departures, excludes holds, future dates, other months and duplicates',()=>{
  const rows=[row('one'),row('one'),row('both',{status:'ended',checkout_date:'2026-09-10'}),row('legacy',{check_in_date:null}),row('old',{check_in_date:'2026-08-31',start_date:'2026-09-01'}),row('future',{check_in_date:'2026-09-30'}),row('reserved',{status:'reserved'}),row('pending',{status:'pending'}),row('other',{property_id:'hidden'}),row('transferred',{check_in_date:'2026-07-05',start_date:'2026-07-05',rooms:{room_number:'15'}})];
  const result=buildTenantMovements(rows,properties,[],new Map(),'2026-09','2026-09-15');
  assert.deepEqual(result.checkIns.map(r=>r.id),['one','both','legacy']);
  assert.deepEqual(result.checkOuts.map(r=>r.id),['both']);
});

test('checkout audit snapshots survive phone release and later room changes',()=>{
  const rows=[row('left',{status:'ended',check_in_date:'2026-07-01',checkout_date:'2026-09-09',tenants:null})];
  const audits=[{entity_id:'left',created_at:'2026-09-10T01:00:00Z',actor_profile_id:'staff',metadata:{tenant_name:'Former tenant name',room_name:'Room 16',property_name:'MGT',note:'Moved out'}},{entity_id:'left',created_at:'2026-09-09T01:00:00Z',metadata:{tenant_name:'Old snapshot'}}];
  const result=buildTenantMovements(rows,properties,audits,new Map([['staff','Maintenance team']]),'2026-09','2026-09-15');
  assert.equal(result.checkOuts[0].tenantName,'Former tenant name');
  assert.equal(result.checkOuts[0].roomName,'Room 16');
  assert.equal(result.checkOuts[0].recordedBy,'Maintenance team');
  assert.equal(result.checkOuts[0].note,'Moved out');
});

test('data loader scopes privileged reads to RLS properties and selected outlet',async()=>{
  reset();datasets.tenancies.push(row('two',{property_id:'p2'}));
  const r=await getMonthlyTenantMovements('2026-09','p2');
  assert.deepEqual(r.checkIns.map(r=>r.id),['two']);
  const query=calls.find(c=>c.table==='tenancies');
  assert.deepEqual(query.operations.find(o=>o[0]==='in'&&o[1]==='property_id'),['in','property_id',['p2']]);
  assert.ok(query.operations.some(o=>o[0]==='or'&&o[1].includes('2026-10-01')));
  calls=[];await getMonthlyTenantMovements('2026-09','unauthorized');
  assert.deepEqual(calls.find(c=>c.table==='tenancies').operations.find(o=>o[0]==='in'&&o[1]==='property_id'),['in','property_id',['p1','p2']]);
});

test('unauthorized roles never load report data; no properties never reads historical records',async()=>{
  for(const unauthorized of ['tenant','owner','maintenance_staff']){reset();role=unauthorized;await assert.rejects(()=>getMonthlyTenantMovements(),/access denied/);assert.equal(calls.length,0);}
  reset();role='admin';propertyAccess='none';await assert.rejects(()=>getMonthlyTenantMovements(),/access denied/);assert.equal(calls.length,0);
  reset();datasets.properties=[];const r=await getMonthlyTenantMovements();assert.equal(r.checkIns.length,0);assert.ok(!calls.some(c=>c.table==='tenancies'));
});

test('report pages through records and fails visibly rather than showing false zero totals',async()=>{
  reset();datasets.tenancies=Array.from({length:501},(_,i)=>row('t'+i));
  assert.equal((await getMonthlyTenantMovements()).checkIns.length,501);
  assert.equal(calls.filter(c=>c.table==='tenancies').length,2);
  for(const table of ['properties','tenancies','audit_logs']) {
    reset();failTable=table;
    const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({month:'2026-09'})}));
    assert.match(html,/role="alert"/);assert.doesNotMatch(html,/No new check-ins recorded|text-3xl font-bold/);
  }
});

test('monthly page renders compact separate tables, filters and linked navigation without mutation controls',async()=>{
  reset();datasets.tenancies.push(row('left',{status:'ended',check_in_date:'2026-08-01',checkout_date:'2026-09-09'}));
  const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({month:'2026-09',property:'p1'})}));
  for(const text of ['Monthly Check-ins &amp; Check-outs','September 2026','New Check-ins','Check-outs','name="month"','name="property"','All outlets','Tenant one','Tenant left','/reservations','month=2026-08&amp;property=p1'])assert.ok(html.includes(text),text);
  assert.doesNotMatch(html,/type="file"|Cancel reservation|Approve tenant|Delete tenant/);
});

test('reservations are discoverable and reuse existing controls only for authorized managers',async()=>{
  reset();datasets.tenant_applications=[{id:'reserve',full_name:'Reserved tenant',property_id:'p1',monthly_rent:350,deposit:150,utility_deposit:0,proposed_start_date:'2026-09-15',verification_status:'pending_verification',rooms:{room_number:'9'}}];
  let html=renderToStaticMarkup(await Reservations({searchParams:Promise.resolve({})}));
  for(const text of ['Reservations','1 active reservations','Reserved tenant','/tenant-movements','Existing slip form','Tenant arriving','Cancel reservation'])assert.ok(html.includes(text),text);
  role='admin';propertyAccess='view';
  html=renderToStaticMarkup(await Reservations({searchParams:Promise.resolve({})}));
  assert.match(html,/Reserved tenant/);assert.doesNotMatch(html,/Existing slip form|Tenant arriving|Cancel reservation/);
  const {roleNavigation,protectedRoutes}=require('../lib/auth/roles.ts');
  const {moduleForPath}=require('../lib/auth/access.ts');
  for(const route of ['/reservations','/tenant-movements']){
    assert.ok(roleNavigation.super_admin.some(n=>n.href===route));
    assert.ok(!roleNavigation.tenant.some(n=>n.href===route));
    assert.ok(protectedRoutes.includes(route));assert.equal(moduleForPath(route),'properties');
  }
});
