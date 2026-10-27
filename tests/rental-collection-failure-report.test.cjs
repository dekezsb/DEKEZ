const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const load = require('./marketplace-component-loader.cjs')({});
const { buildCollectionFailureReportPreview: preview } = load('lib/rental-collection/failure-report.ts');
const id = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const date = '2026-10-27';
function invoice(n = 100, balance = 300) {
  return { id:id(n), property:'Synthetic Property', property_code:'SYN', room:'D1', outstanding:balance,
    paid_amount:200, verified_paid:200, collectible:true, exceptions:[] };
}
function item(n = 4) {
  return { company_id:id(1), report_date:date, tenant_id:id(n), name:`Synthetic Tenant ${n}`, phone:`601911111${n}1`,
    recipient_source:'tenant_portal_login', outstanding:300, collectible_outstanding:300,
    invoices:[invoice(n + 100)], exceptions:[] };
}
function evidence(n = 99, tenant = 4) {
  return { attempt_id:id(n), company_id:id(1), tenant_id:id(tenant), state:'failed', confirmed_failure:true,
    confirmation:'provider_delivery_receipt', failure_code:'delivery_failed', provider_message_id:`synthetic-${n}`, resolved_at:null };
}
function input() {
  return { company_id:id(1), report_date:date, current_items:[item()], evidence:[evidence()],
    all_history_loaded:true, daily_outcomes_complete:true, daily_reservation:'not_reserved',
    recipient_authorization:{ verified:true, company_id:id(1), recipient:'60188702371', management_profile_id:id(3),
      approved_management_account:true, active_company_membership:true, rent_due_tracker_manage:true,
      whatsapp_ownership_verified:true, whatsapp_consent:'opted_in' } };
}

test('one BM consolidated read-only candidate uses current login phone and verified invoice balance', () => {
  const result = preview(input());
  assert.equal(result.recipient, '60188702371');
  assert.equal(result.readOnlyPreview, true); assert.equal(result.canSend, false);
  assert.equal(result.readiness, 'ready_for_review'); assert.equal(result.containsPersonalDetails, true);
  for (const text of ['2026-10-27 (Malaysia)', 'Synthetic Tenant 4', 'SYN / D1', '60191111141', 'RM 300.00', 'Penghantaran mesej gagal (disahkan)']) assert.ok(result.body.includes(text));
  assert.match(result.body, /1 penyewa; 1 percubaan unik/);
  assert.match(result.body, /https:\/\/dekez\.vercel\.app\//);
  assert.doesNotMatch(result.body, /admin-setup\/rental-reminders/);
  assert.match(result.body,/Rosley, sila hubungi semua penyewa/);
  assert.match(result.body,/nombor telefon atau WhatsApp mereka yang terkini dan aktif/);
  assert.match(result.body,/Jangan ubah nombor log masuk penyewa secara automatik/);
});

test('historical unresolved failures are included without report-date filtering and resolved failures excluded', () => {
  const data = input();
  data.current_items.push(item(5));
  data.evidence.push({...evidence(98,5), created_at:'2026-09-01T01:00:00Z'}, {...evidence(97,5), resolved_at:'2026-10-26T01:00:00Z'});
  const result = preview(data);
  assert.equal(result.failureTenants,2); assert.equal(result.confirmedUnresolvedAttempts,2);
  assert.equal(result.excludedAttempts,1); assert.match(result.body,/RM 600.00/);
});

test('deduplicate attempts, tenants and invoice IDs without summing repeated historical balances', () => {
  const data=input(); const second=invoice(105,150);
  data.current_items[0].invoices.push({...data.current_items[0].invoices[0]}, second);
  data.current_items[0].outstanding=450; data.current_items[0].collectible_outstanding=450;
  data.current_items.push(structuredClone(data.current_items[0]));
  data.evidence.push({...data.evidence[0]}, evidence(100));
  const result=preview(data);
  assert.equal(result.failureTenants,1); assert.equal(result.confirmedUnresolvedAttempts,2);
  assert.match(result.body,/RM 450.00/); assert.doesNotMatch(result.body,/RM 750|RM 900/);
});

test('accepted, pending, sending, delivered and uncertain are never counted as confirmed failures', () => {
  for (const state of ['accepted','pending','sending','delivered','uncertain']) {
    const data=input();data.evidence[0].state=state;
    const result=preview(data);assert.equal(result.failureTenants,0);assert.equal(result.confirmedUnresolvedAttempts,0);
    assert.doesNotMatch(result.body,/Synthetic Tenant|60191111141/);
  }
});

test('HTTP/provider rejection, rate-limit and channel problems alone do not prove tenant delivery failure', () => {
  for(const failure_code of ['provider_rejected','rate_limited','channel_error',null,'raw-private-provider-error']) {
    const data=input();data.evidence[0]={...data.evidence[0],state:'rejected',failure_code};
    assert.equal(preview(data).confirmedUnresolvedAttempts,0);
  }
  for(const change of [{confirmed_failure:false},{confirmation:'none'},{provider_message_id:null}]) {
    const data=input();Object.assign(data.evidence[0],change);assert.equal(preview(data).confirmedUnresolvedAttempts,0);
  }
});

test('approved explicit failure reasons use safe fixed labels, never arbitrary provider text', () => {
  const data=input();data.evidence[0]={...data.evidence[0],state:'rejected',failure_code:'recipient_not_on_whatsapp',confirmation:'authorized_management_review',provider_message_id:null,raw_error:'token-secret'};
  const result=preview(data);assert.equal(result.confirmedUnresolvedAttempts,1);
  assert.match(result.body,/Nombor tidak berdaftar di WhatsApp/);assert.doesNotMatch(result.body,/token-secret/);
});

test('any resolved or nonfailure copy of an attempt prevents stale duplicate evidence becoming a new failure', () => {
  for(const change of [{resolved_at:'2026-10-27T01:00:00Z'},{state:'delivered'},{tenant_id:id(5)}]) {
    const data=input();data.evidence.push({...data.evidence[0],...change});assert.equal(preview(data).confirmedUnresolvedAttempts,0);
  }
});

test('number, active company, approved Management and collection permission are required; reports permission is not', () => {
  for(const change of [{verified:false},{company_id:id(2)},{recipient:'60198894911'},{management_profile_id:''},
    {approved_management_account:false},{active_company_membership:false},{rent_due_tracker_manage:false},
    {whatsapp_ownership_verified:false},{whatsapp_consent:'unknown'},{whatsapp_consent:'opted_out'}]) {
    const data=input();Object.assign(data.recipient_authorization,change);const result=preview(data);
    assert.equal(result.readiness,'recipient_unverified'); assert.equal(result.containsPersonalDetails,false);
    assert.doesNotMatch(result.body,/Synthetic Tenant|SYN \/ D1|60191111141|RM 300/);
  }
  const data=input();data.recipient_authorization=null;assert.equal(preview(data).readiness,'recipient_unverified');
  const allowed=input();allowed.recipient_authorization.reports=false;allowed.recipient_authorization.admin_setup=false;
  assert.equal(preview(allowed).readiness,'ready_for_review');
});

test('incomplete historical pages remain a draft; pending current outcomes retain all previous confirmed failures', () => {
  const missingHistory=preview({...input(),all_history_loaded:false});
  assert.equal(missingHistory.readiness,'awaiting_complete_outcomes');
  assert.match(missingHistory.body,/DRAF/);assert.doesNotMatch(missingHistory.body,/Synthetic Tenant|Termasuk semua rekod/);
  const pending=preview({...input(),daily_outcomes_complete:false});
  assert.match(pending.body,/Synthetic Tenant 4/);
  assert.match(pending.body,/masih menunggu pengesahan/);
  assert.match(pending.body,/tanpa mesej WhatsApp kedua/);
  assert.equal(pending.createAdditionalDailyAlert,false);assert.equal(pending.canSend,false);
});

test('oversized complete roster becomes one generic message containing complete counts, never sliced or split', () => {
  const data=input();data.current_items=[];data.evidence=[];
  for(let n=4;n<34;n++){data.current_items.push(item(n));data.evidence.push(evidence(1000+n,n));}
  const result=preview(data);
  assert.equal(result.failureTenants,30);assert.equal(result.confirmedUnresolvedAttempts,30);
  assert.equal(result.completeRosterRequiresPortal,true);assert.equal(result.containsPersonalDetails,false);
  assert.match(result.body,/30 penyewa; 30 percubaan unik/);assert.match(result.body,/Tiada senarai dipotong/);
  assert.doesNotMatch(result.body,/Synthetic Tenant|Telefon log masuk|RM /);assert.ok(result.body.length<=4000);
});

test('same Malaysia date updates a draft only; proposed key is not falsely presented as a durable reservation', () => {
  const initial=preview(input());assert.equal(initial.durableReservationImplemented,false);
  for(const daily_reservation of ['reserved','sent']) {
    const result=preview({...input(),daily_reservation});assert.equal(result.updatedDraftOnly,true);
    assert.equal(result.createAdditionalDailyAlert,false);assert.equal(result.readiness,'existing_daily_report_only');
    assert.equal(result.proposedReservationKey,initial.proposedReservationKey);assert.equal(result.canSend,false);
  }
  assert.equal(preview({...input(),daily_reservation:'unknown'}).readiness,'reservation_unverified');
});

test('missing current source stays unavailable instead of using stale failure-snapshot financial values', () => {
  const data=input();data.current_items=[];data.evidence[0].snapshot={name:'Old private name',outstanding:999999};
  const result=preview(data);assert.equal(result.failureTenants,1);assert.equal(result.unknownBalances,1);
  assert.match(result.body,/Tidak dapat disahkan/);assert.doesNotMatch(result.body,/999999|Old private name/);
});

test('mismatched, shared or unverified invoices never produce invented total or duplicate balance', () => {
  for(const change of [row=>row.invoices[0].verified_paid=199,row=>row.collectible_outstanding=301,
    row=>row.exceptions=['allocation_mismatch'],row=>row.invoices.push({...row.invoices[0],outstanding:400}),
    row=>row.invoices[0].outstanding=NaN]) {
    const data=input();change(data.current_items[0]);const result=preview(data);assert.equal(result.unknownBalances,1);
    assert.doesNotMatch(result.body,/RM 300.00/);
  }
  const data=input();const other=item(5);other.invoices=[data.current_items[0].invoices[0]];
  data.current_items.push(other);data.evidence.push(evidence(100,5));assert.equal(preview(data).unknownBalances,2);
});

test('settled current balances do not silently resolve a still-open communications failure', () => {
  const data=input();Object.assign(data.current_items[0],{outstanding:0,collectible_outstanding:0});
  Object.assign(data.current_items[0].invoices[0],{outstanding:0,paid_amount:500,verified_paid:500});
  const result=preview(data);assert.equal(result.failureTenants,1);assert.match(result.body,/RM 0.00/);
});

test('login number comes only from current portal source; malformed or legacy phone is not silently used', () => {
  for(const change of [{recipient_source:undefined},{phone:'6019\nFAKE'}]) {
    const data=input();Object.assign(data.current_items[0],change);const result=preview(data);
    assert.match(result.body,/Telefon log masuk: Tidak tersedia/);assert.doesNotMatch(result.body,/6019\nFAKE/);
  }
});

test('company/date isolation rejects mixed scope and does not mutate evidence or current data', () => {
  for(const edit of [data=>data.current_items[0].company_id=id(2),data=>data.evidence[0].company_id=id(2),data=>data.current_items[0].report_date='2026-10-26',data=>data.report_date='2026-02-30']) {
    const data=input();edit(data);assert.throws(()=>preview(data));
  }
  const data=input();const copy=structuredClone(data);preview(data);assert.deepEqual(data,copy);
});

test('formatter has no provider, database, environment, permission mutation or network integration', () => {
  const source=fs.readFileSync('lib/rental-collection/failure-report.ts','utf8');
  assert.doesNotMatch(source,/fetch\(|createAdminClient|process\.env|sendWhapi|\.rpc\(|\.from\(/);
  assert.match(source,/canSend: false/);assert.match(source,/durableReservationImplemented: false/);
});
