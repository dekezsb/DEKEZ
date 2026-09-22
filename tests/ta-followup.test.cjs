const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function load(file) {
  const m = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const localRequire = name => name.startsWith('@/') ? load(name.slice(2)+'.ts') : name.startsWith('.') ? load(require('node:path').resolve(require('node:path').dirname(file),name)+'.ts') : require(name);
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-09-22T04:00:00Z'])); } }
  new Function('module', 'exports', 'require', 'Date', code)(m, m.exports, localRequire, TestDate);
  return m.exports;
}
const { canSignAgreement, canApplySignedTerm } = load('lib/tenancy/signing-policy.ts');
const { neverSignedTenancies } = load('lib/tenancy/unsigned-followup.ts');
test('expired unsigned history can be signed; signed, rejected, replaced, draft and terminated cannot', () => {
  for (const status of ['expired', 'pending_signature', 'renewal_pending', 'renewal_sent']) assert.equal(canSignAgreement({ status }), true);
  for (const status of ['signed', 'renewal_signed', 'draft', 'terminated']) assert.equal(canSignAgreement({ status }), false);
  for (const field of ['signed_at', 'admin_rejected_at', 'replacement_agreement_id']) assert.equal(canSignAgreement({ status: 'expired', [field]: 'present' }), false);
});

const { standbyPlan } = load('lib/tenancy/standby-policy.ts');
const term = (changes={}) => ({ id:'one',version_number:1,term_type:'original',term_start_date:'2026-04-01',term_end_date:'2026-09-30',signed_at:null,admin_verified_at:null,admin_rejected_at:null,replacement_agreement_id:null,monthly_rent_snapshot:400,...changes });
test('30-day rule includes unsigned predecessors and preserves six versus twelve months', () => {
  assert.equal(standbyPlan([term()], '2026-08-30').next,null);
  assert.deepEqual(standbyPlan([term()], '2026-08-31').next,{startDate:'2026-10-01',endDate:'2027-03-31',months:6});
  assert.deepEqual(standbyPlan([term({term_start_date:'2025-10-01'})], '2026-09-22').next,{startDate:'2026-10-01',endDate:'2027-09-30',months:12});
});
test('existing next version suppresses duplicates; signed processing and rejected copies are not renewed', () => {
  assert.equal(standbyPlan([term(),term({id:'next',term_type:'renewal',version_number:2,term_start_date:'2026-10-01',term_end_date:'2027-03-31'})], '2026-09-22').next,null);
  assert.equal(standbyPlan([term({signed_at:'2026-09-22'})], '2026-09-22').next,null);
  assert.equal(standbyPlan([term({admin_rejected_at:'2026-09-22'})], '2026-09-22').source,null);
});
test('actual six-month renewal outranks an overlapping twelve-month original; ambiguous durations stop', () => {
  const plan=standbyPlan([term({term_start_date:'2025-10-01',version_number:3}),term({term_type:'renewal',version_number:2})],'2026-09-22');
  assert.equal(plan.next.months,6);
  assert.match(standbyPlan([term({term_start_date:'2025-03-01'})],'2026-09-22').review,/management/);
});
test('portal background maintenance is authenticated and never sends messages or fabricates consent for standby', () => {
  const source=fs.readFileSync('lib/tenancy/agreement.ts','utf8');
  assert.match(source,/decision_status: standbyOnly \? "pending" : "renew"/);
  assert.match(source,/if \(!standbyOnly && agreementStatusForTerm/);
  assert.match(source,/standbyOnly: true/);
  assert.match(source,/decision\?\.decision_status === "not_renew"/);
  assert.match(source,/standby_renewal_prepared/);
  const route=fs.readFileSync('app/api/tenancy-renewals/route.ts','utf8');
  assert.match(route,/!cronSecret \|\| auth !==/);
  assert.match(route,/billing_status\.is\.null/);
});

// Exercise the real preparation/rendering flow with an in-memory Supabase-shaped
// adapter. No live financial, identity or signature records are submitted.
function maintenanceDb() {
  const { malaysiaToday } = load('lib/tenancy/agreement.ts');
  const { addDays, calculateTermEndDate } = load('lib/e-tenancy.ts');
  const start = addDays(malaysiaToday(), -40);
  const end = calculateTermEndDate(start, 6);
  const db = {
    tenancies: [{id:'t',company_id:'company',tenant_id:'tenant',property_id:'property',room_id:'room',status:'active',monthly_rental:400,deposit:200,start_date:start,contract_end:end,tenancy_end_date:end,contract_duration_months:6}],
    tenants:[{id:'tenant',full_name:'Test tenant'}], properties:[{id:'property',name:'Test property',property_code:'TST',is_commercial:false}], rooms:[{id:'room',room_number:'1'}],
    tenancy_agreements:[term({id:'old',tenancy_id:'t',status:'pending_signature',term_start_date:addDays(malaysiaToday(),-200),term_end_date:addDays(malaysiaToday(),-20)})],
    tenancy_renewals:[], tenancy_agreement_templates:[], property_tenancy_settings:[], audit_logs:[], agreement_notifications:[],
  };
  // An exact six-month source ending before the frozen audit date.
  const oldStart = malaysiaToday().slice(0,4)+'-03-01';
  const oldEnd = calculateTermEndDate(oldStart,6);
  db.tenancy_agreements[0].term_start_date=oldStart;
  db.tenancy_agreements[0].term_end_date=oldEnd;
  db.tenancies[0].contract_end=oldEnd; db.tenancies[0].tenancy_end_date=oldEnd;
  const writes=[];
  const client={from(table) {
    assert.ok(table in db, `Unexpected table: ${table}`);
    let action='read', value, single=false, max=Infinity; const filters=[];
    const q={ select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},neq(k,v){filters.push(r=>r[k]!==v);return q;},is(k,v){filters.push(r=>v===null?r[k]==null:r[k]===v);return q;},not(k,op,v){assert.equal(op,'in');filters.push(r=>!v.slice(1,-1).split(',').includes(r[k]));return q;},order(){return q;},limit(n){max=n;return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},insert(v){action='insert';value=v;return q;},update(v){action='update';value=v;return q;},then(resolve,reject){try{
      let rows=db[table].filter(r=>filters.every(f=>f(r))).slice(0,max);
      if(action==='insert'){const row={id:'new-'+table+'-'+db[table].length,...value};db[table].push(row);rows=[row];}
      if(action==='update') rows.forEach(r=>Object.assign(r,value));
      if(action!=='read') writes.push({table,action,value});
      resolve({data:single?(rows[0]??null):rows,error:null});
    }catch(e){reject(e);}}};return q;
  }};
  return {db,client,writes};
}

test('real standby flow creates one offer with no consent, notification or financial mutation, and repeat is idempotent', async () => {
  const {prepareStandbyRenewal}=load('lib/tenancy/agreement.ts');
  const f=maintenanceDb();
  const original=structuredClone(f.db.tenancies[0]);
  const created=await prepareStandbyRenewal(f.client,'t','admin');
  assert.equal(created.length,1);
  assert.equal(f.db.tenancy_agreements.length,2);
  assert.equal(f.db.tenancy_agreements[1].monthly_rent_snapshot,400);
  assert.equal(f.db.tenancy_renewals[0].decision_status,'pending');
  assert.equal(f.db.tenancy_renewals[0].decision_recorded_at,null);
  assert.equal(f.db.agreement_notifications.length,0);
  assert.deepEqual(f.db.tenancies[0],original);
  assert.ok(f.db.audit_logs.some(a=>a.action==='standby_renewal_prepared'));
  assert.deepEqual(await prepareStandbyRenewal(f.client,'t','admin'),[]);
  assert.equal(f.db.tenancy_agreements.length,2);
});

test('non-renewing or signed-processing sources are left alone by real maintenance', async () => {
  const {prepareStandbyRenewal}=load('lib/tenancy/agreement.ts');
  const {addDays}=load('lib/e-tenancy.ts');
  for(const processing of [false,true]) {
    const f=maintenanceDb();
    if(processing) f.db.tenancy_agreements[0].signed_at='2026-09-22';
    else f.db.tenancy_renewals.push({tenancy_id:'t',new_start_date:addDays(f.db.tenancy_agreements[0].term_end_date,1),decision_status:'not_renew'});
    assert.deepEqual(await prepareStandbyRenewal(f.client,'t','admin'),[]);
    assert.equal(f.writes.length,0);
  }
});
test('historical or older terms cannot roll dates, rent or deposits backward', () => {
  assert.equal(canApplySignedTerm('2026-09-07', '2026-09-22', ['2026-09-07', null]), false);
  assert.equal(canApplySignedTerm('2027-03-07', '2026-09-22', ['2027-09-07', null]), false);
  assert.equal(canApplySignedTerm('2027-03-07', '2026-09-22', [null, '2027-09-07']), false);
  assert.equal(canApplySignedTerm(null, '2026-09-22', []), false);
  assert.equal(canApplySignedTerm('2027-03-07', '2026-09-22', ['2026-09-07', null]), true);
});
const row = (overrides={}) => ({ tenancy_id:'t1', id:'v1', version_number:1, status:'pending_signature', term_type:'original', term_start_date:'2026-03-08', term_end_date:'2026-09-07', signed_at:null, admin_rejected_at:null, replacement_agreement_id:null, tenancies:{status:'active',checkout_date:null}, ...overrides });
test('never-signed followup includes expired V1 and ready V2 regardless of stale status label', () => {
  const result=neverSignedTenancies([row(), row({id:'v2',version_number:2,term_type:'renewal',term_start_date:'2026-09-08',term_end_date:'2027-03-07'})], '2026-09-22');
  assert.equal(result.length,1); assert.equal(result[0].expired,true); assert.equal(result[0].standby,true); assert.equal(result[0].overlap,false);
});
test('signed-in-process tenants and previous occupants are excluded from never-signed list', () => {
  assert.equal(neverSignedTenancies([row(),row({id:'v2',signed_at:'2026-09-22',status:'signed'})], '2026-09-22').length,0);
  assert.equal(neverSignedTenancies([row({tenancies:{status:'ended',checkout_date:'2026-09-01'}})],'2026-09-22').length,0);
});

test('management followup identifies the current room after transfer without rewriting historical agreement snapshots', () => {
  const old = row({property_name_snapshot:'DGG',room_name_snapshot:'Room 6',tenancies:{status:'active',checkout_date:null,properties:{name:'DGG'},rooms:{room_number:'Room 15'},tenants:{full_name:'Current tenant'}}});
  const [result]=neverSignedTenancies([old],'2026-09-22');
  assert.equal(result.roomName,'Room 15');
  assert.equal(result.tenantName,'Current tenant');
  assert.equal(result.pending[0].room_name_snapshot,'Room 6');
});
test('overlapping historical copies are flagged, not silently offered as consecutive terms', () => {
  const result=neverSignedTenancies([row(),row({id:'v3',version_number:3,term_end_date:'2027-03-07'})],'2026-09-22');
  assert.equal(result[0].overlap,true);
});
test('server retains ownership, active tenant, no signature and compare-and-set guards', () => {
  const action=fs.readFileSync('app/e-tenancy/actions.ts','utf8');
  assert.match(action,/tenant\.profile_id !== user\.id/);
  assert.match(action,/tenancy\.status !== "active" \|\| tenancy\.checkout_date/);
  assert.match(action,/\.is\("signed_at", null\)/);
  assert.match(action,/applyCurrentTerm &&\s+agreement\.term_type === "renewal"/);
  assert.match(action,/property\?\.is_commercial && applyCurrentTerm/);
  assert.match(action,/renewalUpdate\.eq\(field, tenancy\[field\]\)/);
  assert.match(action,/signed_at: signedAt/);
});
test('scheduled maintenance does not recreate original after a renewal and management list has no eight-row cutoff', () => {
  const source=fs.readFileSync('lib/tenancy/agreement.ts','utf8').split('export async function ensureCurrentAgreementTerms')[1];
  assert.match(source,/if \(!existingOriginal\) \{\s+const originalId = await createAgreementForTenancy/);
  const ui=fs.readFileSync('components/dashboard/agreement-renewal-reminders.tsx','utf8');
  assert.doesNotMatch(ui,/matching\.slice\(0, 8\)/);
  assert.match(ui,/\{item\.agreementId \? \(/);
});
