const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const load=require('./renovation-loader.cjs'),model=load('lib/owner/model.ts'),access=load('lib/auth/access.ts');
const base=()=>({properties:[{id:'a',name:'A'},{id:'b',name:'B'}],rooms:[],collections:[],receipts:[],expenses:[],statements:[],documents:[],agreements:[],payouts:[],claims:[]});
test('client owner has no internal module rights even with old permission overrides',()=>{
 assert.ok(Object.values(access.getRoleDefaultAccess('client_owner')).every(x=>x==='none'));
 assert.ok(Object.values(access.resolveUserAccess('client_owner',access.accessModules.map(module_key=>({module_key,access_level:'manage'})))).every(x=>x==='none'));
 assert.equal(access.getRoleDefaultAccess('owner').reports,'view');assert.equal(access.getRoleDefaultAccess('super_admin').reports,'manage');
});
test('potential is configured rent; vacancies, occupied and reserved are separate; zero rooms safe',()=>{
 assert.deepEqual(model.occupancy([]),{total:0,occupied:0,vacant:0,other:0,percent:0,potential:0,occupiedValue:0,vacancy:0});
 const o=model.occupancy([{status:'occupied',rent:600},{status:'vacant',rent:700},{status:'reserved',rent:800}]);assert.equal(o.potential,2100);assert.equal(o.occupiedValue,600);assert.equal(o.vacancy,700);assert.equal(o.other,1);assert.equal(o.percent,33.3);
});
test('actual receipts separate from billed income/potential; partial statement coverage not a portfolio payout',()=>{
 const d=base();d.receipts=[{amount:400},{amount:100}];d.collections=[{outstanding:300,amount:800,paid:500}];d.expenses=[{amount:50}];d.statements=[{property_id:'a',net:350,fee:100}];
 assert.deepEqual(model.ownerTotals(d),{collected:500,outstanding:300,expenses:50,net:null,fees:null});assert.equal(model.ownerTotals(d,'a').net,350);
});
test('statuses handle overdue, partial payment, no vacancy, terminated and expiring agreements',()=>{
 assert.equal(model.paymentStatus({outstanding:0,paid:100,date:'2020-01-01'}),'Paid');assert.equal(model.paymentStatus({outstanding:20,paid:80,date:'2020-01-01'}),'Partial');assert.equal(model.paymentStatus({outstanding:100,paid:0,date:'2020-01-01'}),'Overdue');
 assert.equal(model.agreementStatus({start:'2026-01-01',end:'2026-11-01',terminated:null},'2026-10-22'),'Expiring soon');assert.equal(model.agreementStatus({start:'2026-01-01',end:'2026-11-01',terminated:'2026-10-01'},'2026-10-22'),'Terminated');
 assert.equal(model.payoutStatus({net:1200,paid:300}),'Partially paid');assert.equal(model.payoutStatus({net:1200,paid:1200}),'Paid');
});
test('safe month parsing and navigation retain property/month across all sections',()=>{
 assert.equal(model.ownerMonth('2026-10'),'2026-10');assert.notEqual(model.ownerMonth('2026-99'),'2026-99');assert.equal(model.ownerHref('finance/expenses','2026-10','p'),'\/owner/finance/expenses?month=2026-10&property=p');
 assert.equal(model.malaysiaDate(new Date('2026-10-21T18:00:00Z')),'2026-10-22');
});
test('document endpoint checks scoped snapshot and never accepts bucket/path from URL',()=>{
 const code=fs.readFileSync('app/owner/documents/[id]/route.ts','utf8');assert.match(code,/data.documents.find/);assert.match(code,/eq\('owner_id',ownerId\)/);assert.match(code,/createSignedUrl\(doc.file_path,60/);assert.doesNotMatch(code,/searchParams.get\('(bucket|path|owner)'/);
});
