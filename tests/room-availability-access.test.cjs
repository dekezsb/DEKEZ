const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
const load = Module._load;
let role, access, reads = 0;
const rooms = ['vacant','contract_active','contract_expired','reserved','maintenance'].map((status,i)=>({id:`r${i}`,propertyId:'property',roomNumber:`A${i+1}`,availabilityStatus:status,tenantName:'Private tenant',tenancyId:'tenancy',checkInDate:'2026-08-01',contractEnd:'2027-08-01',depositOutstanding:200}));
const map = {totalRooms:5,vacantRooms:1,activeContractRooms:1,expiredContractRooms:1,otherUnavailableRooms:2,properties:[{id:'property',code:'SLS',name:'Sulaman',address:'Example address',rooms}]};
Module._resolveFilename = function(request,...args){return resolve.call(this,request.startsWith('@/')?path.join(root,request.slice(2)):request,...args);};
Module._load = function(request,...args){
  if(request==='next/navigation')return {redirect:()=>{throw Error('access denied');}};
  if(request==='@/lib/auth/session')return {requireRole:async(allowed)=>{if(!allowed.includes(role))throw Error('access denied');return role;},getCurrentUserAccess:async()=>({role,access})};
  if(request==='@/lib/data/room-availability')return {getRoomAvailabilityMap:async()=>{reads++;return map;}};
  if(request==='@/components/app-link')return {Link:({children,...props})=>React.createElement('a',props,children)};
  if(request==='@/app/properties/[id]/quick-checkout-dialog')return {QuickCheckoutDialog:()=>React.createElement('button',null,'Checkout control')};
  return load.call(this,request,...args);
};
for(const ext of ['.ts','.tsx'])Module._extensions[ext]=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const {getRoleDefaultAccess,moduleForPath,hasModuleAccess,resolveUserAccess} = require('../lib/auth/access.ts');
const {roleNavigation} = require('../lib/auth/roles.ts');
const Page = require('../app/room-availability/page.tsx').default;
const render = async()=>renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));

test('maintenance roles can view all room states without property controls or tenant details',async()=>{
  for(role of ['technician','maintenance_staff','cleaning_staff']){
    access=getRoleDefaultAccess(role);
    const html=await render();
    for(const text of ['Room Availability Map','Vacant','Occupied · TA active','Occupied · TA expired','Reserved','Maintenance','A1','A5'])assert.ok(html.includes(text),text);
    assert.doesNotMatch(html,/Private tenant|Deposit outstanding|Open Room|Register Tenant|Checkout control/);
    assert.match(html,/read-only/);
    const nav=roleNavigation[role].find(n=>n.href==='/room-availability');
    assert.ok(nav&&hasModuleAccess(access,nav.module));
    assert.ok(roleNavigation[role].indexOf(nav)<4,'visible in mobile quick navigation');
  }
});

test('operational admin with Properties disabled can see the map but not property management',async()=>{
  role='admin';
  access=resolveUserAccess(role,[{module_key:'properties',access_level:'none'},{module_key:'maintenance',access_level:'manage'},{module_key:'tenant_checkout',access_level:'manage'}]);
  const html=await render();
  assert.match(html,/Room Availability Map/);
  assert.doesNotMatch(html,/Private tenant|Open Room|Register Tenant|Checkout control/);
  const nav=roleNavigation.admin.find(n=>n.href==='/room-availability');
  assert.ok(nav&&hasModuleAccess(access,nav.module));
  assert.equal(access.properties,'none','does not grant broad Properties access');
});

test('tenants and disabled maintenance accounts cannot load the room map',async()=>{
  for(role of ['tenant','maintenance_staff','admin','owner']){
    access={...getRoleDefaultAccess(role),properties:'none',maintenance:'none'};
    const before=reads;
    await assert.rejects(render,/access denied/);
    assert.equal(reads,before,'authorization precedes data loading');
  }
  assert.ok(!roleNavigation.tenant.some(n=>n.href==='/room-availability'));
});

test('main portal retains tenant details and existing property actions',async()=>{
  role='super_admin';access=getRoleDefaultAccess(role);
  const html=await render();
  assert.match(html,/Private tenant/);assert.match(html,/Deposit outstanding/);
  assert.match(html,/Open Room/);assert.match(html,/Checkout control/);
});

test('shared route relies on page authorization, and both staff dashboards have an entry',()=>{
  assert.equal(moduleForPath('/room-availability'),null);
  assert.equal(moduleForPath('/properties/test'),'properties');
  const source=fs.readFileSync(path.join(root,'app/dashboard/page.tsx'),'utf8');
  assert.equal((source.match(/href="\/room-availability"/g)||[]).length,2);
});
